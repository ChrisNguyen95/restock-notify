const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Restock Notify API is running.");
});

app.post('/apps/restock-notify', async (req, res) => {
  const { email, tag } = req.body;

  if (!email || !tag) return res.status(400).json({ error: 'Missing email or tag' });

  try {
    const searchRes = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const customers = searchRes.data.customers;

    if (customers.length > 0) {
      const customer = customers[0];
      const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()) : [];
      if (!tags.includes(tag)) tags.push(tag);

      await axios.put(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/${customer.id}.json`, {
        customer: { id: customer.id, tags: tags.join(', ') }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      return res.json({ message: 'Tag updated for existing customer' });
    } else {
      await axios.post(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers.json`, {
        customer: { email: email, tags: tag }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      return res.json({ message: 'New customer created with tag' });
    }

  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
