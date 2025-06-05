
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Restock Notify API is running.");
});

// Helper function to get product and variant info
async function getProductInfo(productId, variantId = null) {
  try {
    const productRes = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/products/${productId}.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const product = productRes.data.product;
    let variant = null;
    
    if (variantId) {
      variant = product.variants.find(v => v.id.toString() === variantId.toString());
    }
    
    return {
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        link: `https://${SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '')}.com/products/${product.handle}`
      },
      variant: variant ? {
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compare_at_price: variant.compare_at_price
      } : null
    };
  } catch (error) {
    console.error('Error fetching product info:', error.response?.data || error.message);
    return null;
  }
}

// Helper function to create tags
function createProductTags(productInfo, baseTag) {
  const { product, variant } = productInfo;
  
  // Tag 1: Simple format for workflow - productId-variantId
  const workflowTag = variant ? `${product.id}-${variant.id}` : `${product.id}`;
  
  // Tag 2: Structured tag with full info
  let structuredTagParts = [
    baseTag || 'restock',
    product.id,
    variant ? variant.id : 'no-variant',
    product.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
    variant ? variant.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() : 'default',
    product.link
  ];
  
  const structuredTag = structuredTagParts.join('|');
  
  return {
    workflowTag,
    structuredTag
  };
}

// Helper function to parse product tag
function parseProductTag(tag) {
  const parts = tag.split('|');
  if (parts.length >= 6) {
    return {
      baseTag: parts[0],
      productId: parts[1],
      variantId: parts[2] !== 'no-variant' ? parts[2] : null,
      productName: parts[3].replace(/_/g, ' '),
      variantName: parts[4] !== 'default' ? parts[4].replace(/_/g, ' ') : null,
      productLink: parts[5]
    };
  }
  return null;
}

app.post('/apps/restock-notify', async (req, res) => {
  const { email, productId, variantId, customTag } = req.body;
  console.log('Received request:', req.body);
  
  if (!email || !productId) {
    return res.status(400).json({ error: 'Missing email or productId' });
  }
  
  try {
    // Get product information
    const productInfo = await getProductInfo(productId, variantId);
    if (!productInfo) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Create both tags
    const { workflowTag, structuredTag } = createProductTags(productInfo, customTag);
    
    // Search for existing customer
    const searchRes = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const customers = searchRes.data.customers;
    
    if (customers.length > 0) {
      // Update existing customer
      const customer = customers[0];
      const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
      
      // Check if similar product tags already exist
      const workflowTagExists = tags.includes(workflowTag);
      const existingStructuredIndex = tags.findIndex(tag => {
        const parsed = parseProductTag(tag);
        return parsed && 
               parsed.productId === productId.toString() && 
               parsed.variantId === (variantId ? variantId.toString() : null);
      });
      
      // Add workflow tag if not exists
      if (!workflowTagExists) {
        tags.push(workflowTag);
      }
      
      // Add or update structured tag
      if (existingStructuredIndex !== -1) {
        tags[existingStructuredIndex] = structuredTag;
      } else {
        tags.push(structuredTag);
      }
      
      await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`, {
        customer: {
          id: customer.id,
          tags: tags.join(', '),
          accepts_marketing: true,
          accepts_marketing_updated_at: new Date().toISOString(),
          marketing_opt_in_level: 'confirmed_opt_in',
          email_marketing_consent: {
            state: 'subscribed',
            opt_in_level: 'confirmed_opt_in',
            consent_updated_at: new Date().toISOString()
          }
        }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      return res.json({ 
        message: 'Product restock notification updated for existing customer',
        customer_id: customer.id,
        product_info: productInfo,
        workflow_tag: workflowTag,
        structured_tag: structuredTag
      });
      
    } else {
      // Create new customer
      const newCustomerRes = await axios.post(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers.json`, {
        customer: {
          email: email,
          tags: `${workflowTag}, ${structuredTag}`, // Both tags
          accepts_marketing: true,
          accepts_marketing_updated_at: new Date().toISOString(),
          marketing_opt_in_level: 'confirmed_opt_in',
          email_marketing_consent: {
            state: 'subscribed',
            opt_in_level: 'confirmed_opt_in',
            consent_updated_at: new Date().toISOString()
          },
          verified_email: true,
          send_email_welcome: false
        }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      // Sau khi tạo, update lại lần nữa để đảm bảo
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${newCustomerRes.data.customer.id}.json`, {
        customer: {
          accepts_marketing: true,
          marketing_opt_in_level: 'confirmed_opt_in',
          email_marketing_consent: {
            state: 'subscribed',
            opt_in_level: 'confirmed_opt_in',
            consent_updated_at: new Date().toISOString()
          }
        }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      return res.json({ 
        message: 'New customer created with product restock notification',
        customer_id: newCustomerRes.data.customer.id,
        product_info: productInfo,
        workflow_tag: workflowTag,
        structured_tag: structuredTag
      });
    }
    
  } catch (err) {
    console.error('Shopify API Error:', err.response?.data || err.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.response?.data?.errors || err.message 
    });
  }
});

// API để lấy danh sách sản phẩm đang chờ restock của customer
app.get('/apps/restock-notify/customer/:email', async (req, res) => {
  const { email } = req.params;
  
  try {
    const searchRes = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (searchRes.data.customers.length === 0) {
      return res.json({ message: 'Customer not found', products: [] });
    }
    
    const customer = searchRes.data.customers[0];
    const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
    
    const restockProducts = tags
      .map(tag => parseProductTag(tag))
      .filter(parsed => parsed !== null);
    
    return res.json({
      customer_id: customer.id,
      email: customer.email,
      restock_products: restockProducts
    });
    
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.response?.data?.errors || err.message 
    });
  }
});

// API để xóa restock notification
app.delete('/apps/restock-notify', async (req, res) => {
  const { email, productId, variantId } = req.body;
  
  if (!email || !productId) {
    return res.status(400).json({ error: 'Missing email or productId' });
  }
  
  try {
    const searchRes = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (searchRes.data.customers.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const customer = searchRes.data.customers[0];
    const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
    
    // Remove matching tags (both workflow and structured)
    const workflowTagToRemove = variantId ? `${productId}-${variantId}` : `${productId}`;
    
    const filteredTags = tags.filter(tag => {
      // Remove workflow tag
      if (tag === workflowTagToRemove) {
        return false;
      }
      
      // Remove structured tag
      const parsed = parseProductTag(tag);
      if (parsed && 
          parsed.productId === productId.toString() && 
          parsed.variantId === (variantId ? variantId.toString() : null)) {
        return false;
      }
      
      return true;
    });
    
    await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`, {
      customer: {
        id: customer.id,
        tags: filteredTags.join(', ')
      }
    }, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    return res.json({ 
      message: 'Restock notification removed',
      customer_id: customer.id 
    });
    
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.response?.data?.errors || err.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
Made with
