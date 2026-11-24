require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PRICE = Math.max(1, Number(process.env.PRICE_PER_PDF || 150));
const CURRENCY = process.env.CURRENCY || 'INR';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const adminPasswordHash = process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) : null;

const required = ['MONGODB_URI','ADMIN_EMAIL','ADMIN_PASSWORD','JWT_SECRET','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','CLOUDINARY_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) console.warn(`Missing environment variables: ${missing.join(', ')}. Configure them before using the portal.`);

cloudinary.config({ secure: true });
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

const requestSchema = new mongoose.Schema({
  requestId: { type: String, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  email: { type: String, trim: true, lowercase: true, maxlength: 150 },
  instructions: { type: String, required: true, maxlength: 3000 },
  originalFile: { url: String, publicId: String, name: String },
  correctedFile: { url: String, publicId: String, name: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  paymentStatus: { type: String, enum: ['created','paid','failed'], default: 'created', index: true },
  workStatus: { type: String, enum: ['New Request','In Progress','Completed','Delivered'], default: 'New Request' },
  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: String,
  paidAt: Date,
  adminNote: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});
const Request = mongoose.model('Request', requestSchema);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfName = path.extname(file.originalname).toLowerCase() === '.pdf';
    cb(isPdfMime && isPdfName ? null : new Error('Please upload a valid PDF file.'), isPdfMime && isPdfName);
  }
});

function uploadToCloudinary(buffer, filename, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: 'raw', folder: `gg-associates/${folder}`,
      public_id: `${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_')}${path.extname(filename).toLowerCase()}`,
      use_filename: false, unique_filename: true
    }, (err, result) => err ? reject(err) : resolve(result));
    stream.end(buffer);
  });
}
function makeRequestId() { return `GG-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function signAdmin(payload) { return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' }); }
function adminOnly(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Admin login required.' });
  try { req.admin = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
}
function safeRequest(r) {
  return { requestId:r.requestId, name:r.name, phone:r.phone, email:r.email, instructions:r.instructions,
    originalFile:r.originalFile, correctedFile:r.correctedFile, amount:r.amount, currency:r.currency,
    paymentStatus:r.paymentStatus, workStatus:r.workStatus, razorpayOrderId:r.razorpayOrderId,
    razorpayPaymentId:r.razorpayPaymentId, paidAt:r.paidAt, adminNote:r.adminNote, createdAt:r.createdAt };
}

// Razorpay webhooks require the exact raw request body for signature validation.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    if (!secret || !signature) return res.status(400).send('Webhook not configured');
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).send('Invalid signature');
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id || event.payload?.order?.entity?.id;
      if (orderId) await Request.findOneAndUpdate({ razorpayOrderId: orderId }, {
        $set: { paymentStatus: 'paid', ...(payment?.id ? { razorpayPaymentId: payment.id } : {}), paidAt: new Date() }
      });
    }
    if (event.event === 'payment.failed') {
      const orderId = event.payload?.payment?.entity?.order_id;
      if (orderId) await Request.findOneAndUpdate({ razorpayOrderId: orderId, paymentStatus: { $ne: 'paid' } }, { $set: { paymentStatus: 'failed' } });
    }
    res.json({ received: true });
  } catch (e) { console.error('Webhook error:', e.message); res.status(500).send('Webhook processing failed'); }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/config', (req,res) => res.json({ businessName: process.env.BUSINESS_NAME || 'GG ASSOCIATES', pricePerPdf: PRICE, currency: CURRENCY, razorpayKeyId: process.env.RAZORPAY_KEY_ID || '' }));

app.post('/api/requests', upload.single('pdf'), async (req,res) => {
  try {
    if (!mongoose.connection.readyState) return res.status(503).json({ error: 'Service is starting. Please try again shortly.' });
    const { name, phone, email, instructions } = req.body;
    if (!name?.trim() || !phone?.trim() || !instructions?.trim() || !req.file) return res.status(400).json({ error: 'Name, phone, instructions and PDF are required.' });
    if (!/^\+?[0-9\s()-]{8,18}$/.test(phone.trim())) return res.status(400).json({ error: 'Please enter a valid phone number.' });
    if (!razorpay) return res.status(503).json({ error: 'Online payment is not configured yet.' });
    const stored = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'originals');
    const requestId = makeRequestId();
    const amount = PRICE * 100;
    const order = await razorpay.orders.create({ amount, currency: CURRENCY, receipt: requestId, notes: { requestId, clientName: name.trim() } });
    const doc = await Request.create({ requestId, name: name.trim(), phone: phone.trim(), email: email?.trim(), instructions: instructions.trim(),
      originalFile: { url: stored.secure_url, publicId: stored.public_id, name: req.file.originalname }, amount: PRICE, currency: CURRENCY, razorpayOrderId: order.id });
    res.status(201).json({ requestId: doc.requestId, orderId: order.id, amount, currency: CURRENCY, keyId: process.env.RAZORPAY_KEY_ID, name: doc.name, email: doc.email, phone: doc.phone });
  } catch (e) { console.error('Create request:', e); res.status(500).json({ error: e.message || 'Unable to create request.' }); }
});

app.post('/api/payments/verify', async (req,res) => {
  try {
    const { requestId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const doc = await Request.findOne({ requestId });
    if (!doc || doc.razorpayOrderId !== razorpay_order_id) return res.status(404).json({ error: 'Request or payment order not found.' });
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${doc.razorpayOrderId}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(String(razorpay_signature || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).json({ error: 'Payment signature verification failed.' });
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.order_id !== doc.razorpayOrderId || payment.status !== 'captured' || payment.amount !== doc.amount * 100) {
      return res.status(409).json({ error: 'Payment is not captured yet. Please wait a moment and refresh your request status.' });
    }
    doc.paymentStatus = 'paid'; doc.razorpayPaymentId = razorpay_payment_id; doc.paidAt = new Date(); await doc.save();
    res.json({ success: true, requestId: doc.requestId, message: 'Payment verified. Your request has been received.' });
  } catch (e) { console.error('Payment verification:', e); res.status(500).json({ error: 'Unable to verify payment. If money was deducted, contact support with your request ID.' }); }
});

app.get('/api/track/:requestId', async (req,res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    const doc = await Request.findOne({ requestId: req.params.requestId.toUpperCase(), phone });
    if (!doc) return res.status(404).json({ error: 'No request found. Check your request ID and phone number.' });
    res.json({ requestId:doc.requestId, paymentStatus:doc.paymentStatus, workStatus:doc.workStatus, createdAt:doc.createdAt,
      correctedFile: doc.workStatus === 'Delivered' ? doc.correctedFile : undefined, adminNote:doc.adminNote });
  } catch { res.status(500).json({ error: 'Unable to check request status.' }); }
});

app.post('/api/admin/login', async (req,res) => {
  const { email, password } = req.body;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) return res.status(401).json({ error: 'Invalid email or password.' });
  const valid = adminPasswordHash ? await bcrypt.compare(String(password || ''), adminPasswordHash) : false;
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ token: signAdmin({ email: process.env.ADMIN_EMAIL }), email: process.env.ADMIN_EMAIL });
});
app.get('/api/admin/requests', adminOnly, async (req,res) => {
  const docs = await Request.find().sort({ createdAt: -1 }).limit(500);
  res.json(docs.map(safeRequest));
});
app.patch('/api/admin/requests/:id', adminOnly, async (req,res) => {
  try {
    const allowed = ['New Request','In Progress','Completed','Delivered'];
    const { workStatus, adminNote } = req.body;
    if (workStatus && !allowed.includes(workStatus)) return res.status(400).json({ error: 'Invalid work status.' });
    const doc = await Request.findOne({ requestId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Request not found.' });
    if (doc.paymentStatus !== 'paid') return res.status(403).json({ error: 'Only paid requests can be processed.' });
    if (workStatus) doc.workStatus = workStatus;
    if (adminNote !== undefined) doc.adminNote = String(adminNote).slice(0,2000);
    await doc.save(); res.json(safeRequest(doc));
  } catch { res.status(500).json({ error: 'Unable to update request.' }); }
});
app.post('/api/admin/requests/:id/deliver', adminOnly, upload.single('pdf'), async (req,res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Select the corrected PDF first.' });
    const doc = await Request.findOne({ requestId: req.params.id });
    if (!doc || doc.paymentStatus !== 'paid') return res.status(404).json({ error: 'Paid request not found.' });
    const stored = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'corrected');
    doc.correctedFile = { url: stored.secure_url, publicId: stored.public_id, name: req.file.originalname };
    doc.workStatus = 'Delivered'; await doc.save(); res.json(safeRequest(doc));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Unable to upload corrected PDF.' }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err,req,res,next) => { console.error(err.message); res.status(err instanceof multer.MulterError ? 400 : 400).json({ error: err.message || 'Request failed.' }); });

mongoose.connect(process.env.MONGODB_URI || '')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection failed:', err.message));
app.listen(PORT, () => console.log(`GG ASSOCIATES portal running on port ${PORT}`));
