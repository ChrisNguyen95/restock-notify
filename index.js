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

app.post('/apps/restock-notify', async (req, res) => {
  const { email, tag, productHandle } = req.body;
  console.log('Received request:', req.body);
  
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }
  
  // Tạo các tags cần thiết
  const tagsToAdd = [];
  
  // Thêm tag gốc nếu có
  if (tag) {
    tagsToAdd.push(tag);
  }
  
  // Thêm tag restock với product handle nếu có
  if (productHandle) {
    tagsToAdd.push(`restock-${productHandle}`);
  }
  
  if (tagsToAdd.length === 0) {
    return res.status(400).json({ error: 'Missing tag or productHandle' });
  }
  
  try {
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
      const existingTags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
      
      // Thêm các tags mới nếu chưa có
      tagsToAdd.forEach(newTag => {
        if (!existingTags.includes(newTag)) {
          existingTags.push(newTag);
        }
      });
      
      await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`, {
        customer: {
          id: customer.id,
          tags: existingTags.join(', '),
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
        message: 'Tags and marketing subscription updated for existing customer',
        customer_id: customer.id,
        tags_added: tagsToAdd
      });
      
    } else {
      // Create new customer
      const newCustomerRes = await axios.post(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers.json`, {
        customer: {
          email: email,
          tags: tagsToAdd.join(', '),
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
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
      
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
        message: 'New customer created with tags and subscribed to marketing',
        customer_id: newCustomerRes.data.customer.id,
        tags_added: tagsToAdd
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
