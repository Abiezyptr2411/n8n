const express = require('express');
const midtransClient = require('midtrans-client');
const axios = require('axios');
const path = require('path');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ─── In-memory Transaction Store ─────────────────────────────────────────────
const transactions = [];

function upsertTransaction(data) {
  const idx = transactions.findIndex(t => t.order_id === data.order_id);
  const record = {
    order_id:           data.order_id,
    amount:             data.gross_amount || data.amount || 0,
    status:             data.transaction_status || 'pending',
    payment_type:       data.payment_type || '-',
    customer_email:     data.customer_details?.email || data.customerEmail || '-',
    customer_name:      data.customer_details?.first_name || data.customerName || '-',
    updated_at:         new Date().toISOString(),
    created_at:         idx >= 0 ? transactions[idx].created_at : new Date().toISOString(),
  };
  if (idx >= 0) transactions[idx] = record;
  else transactions.unshift(record);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// GET all transactions (for dashboard)
app.get('/transactions', (req, res) => {
  res.json({ data: transactions, total: transactions.length });
});

// POST create transaction
app.post('/create-transaction', async (req, res) => {
  const { orderId, amount, customerEmail, customerName } = req.body;

  const parameter = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    customer_details:    { email: customerEmail, first_name: customerName }
  };

  try {
    const transaction = await snap.createTransaction(parameter);

    // Simpan ke store dengan status pending
    upsertTransaction({
      order_id:           orderId,
      gross_amount:       amount,
      transaction_status: 'pending',
      customerEmail,
      customerName,
    });

    res.json({ token: transaction.token, redirect_url: transaction.redirect_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST terima notifikasi dari Midtrans → forward ke n8n → update store
app.post('/midtrans-notification', async (req, res) => {
  try {
    upsertTransaction(req.body);

    // Forward ke n8n webhook
    await axios.post(process.env.N8N_WEBHOOK_URL, req.body);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST manual sync → kirim ulang semua transaksi ke n8n
app.post('/sync-n8n', async (req, res) => {
  try {
    const results = [];
    for (const tx of transactions) {
      const r = await axios.post(process.env.N8N_WEBHOOK_URL, {
        order_id:           tx.order_id,
        transaction_status: tx.status,
        gross_amount:       tx.amount,
        payment_type:       tx.payment_type,
        customer_details:   { email: tx.customer_email }
      });
      results.push({ order_id: tx.order_id, n8n_status: r.status });
    }
    res.json({ synced: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
  console.log(`Dashboard → http://localhost:${process.env.PORT}`);
});