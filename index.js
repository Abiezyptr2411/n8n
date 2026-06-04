const express = require('express');
const midtransClient = require('midtrans-client');
const axios = require('axios');
const path = require('path');
const { Pool } = require('pg');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ─── Database (Supabase) ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Midtrans ─────────────────────────────────────────────────────────────────
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY
});

// ─── Endpoints ────────────────────────────────────────────────────────────────

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// GET all transactions dari Supabase
app.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ data: result.rows, total: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create transaction → simpan ke DB dengan status pending
app.post('/create-transaction', async (req, res) => {
  const { orderId, amount, customerEmail, customerName } = req.body;

  const parameter = {
    transaction_details: { order_id: orderId, gross_amount: amount },
    customer_details:    { email: customerEmail, first_name: customerName }
  };

  try {
    const transaction = await snap.createTransaction(parameter);

    // Simpan ke Supabase langsung saat create
    await pool.query(
      `INSERT INTO transactions (order_id, status, amount, customer_email, customer_name)
       VALUES ($1, 'pending', $2, $3, $4)
       ON CONFLICT (order_id) DO NOTHING`,
      [orderId, amount, customerEmail, customerName]
    );

    res.json({ token: transaction.token, redirect_url: transaction.redirect_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST terima notifikasi dari Midtrans → update DB → forward ke n8n
app.post('/midtrans-notification', async (req, res) => {
  try {
    const {
      order_id,
      transaction_status,
      gross_amount,
      payment_type,
      customer_details
    } = req.body;

    // Upsert ke Supabase
    await pool.query(
      `INSERT INTO transactions (order_id, status, amount, payment_type, customer_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO UPDATE SET
         status       = EXCLUDED.status,
         amount       = EXCLUDED.amount,
         payment_type = EXCLUDED.payment_type,
         customer_email = COALESCE(EXCLUDED.customer_email, transactions.customer_email)`,
      [
        order_id,
        transaction_status,
        parseInt(gross_amount) || 0,
        payment_type || null,
        customer_details?.email || null
      ]
    );

    // Forward ke n8n webhook
    await axios.post(process.env.N8N_WEBHOOK_URL, req.body);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST manual sync → kirim semua transaksi ke n8n
app.post('/sync-n8n', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM transactions ORDER BY created_at DESC`);
    const txList = result.rows;

    for (const tx of txList) {
      await axios.post(process.env.N8N_WEBHOOK_URL, {
        order_id:           tx.order_id,
        transaction_status: tx.status,
        gross_amount:       tx.amount,
        payment_type:       tx.payment_type,
        customer_details:   { email: tx.customer_email }
      });
    }

    res.json({ synced: txList.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard → http://localhost:${PORT}`);
});