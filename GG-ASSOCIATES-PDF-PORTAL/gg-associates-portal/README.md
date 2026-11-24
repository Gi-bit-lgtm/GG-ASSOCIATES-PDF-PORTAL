# GG ASSOCIATES — PDF Correction Portal

A single Node.js application that serves the customer website and admin dashboard, stores requests in MongoDB Atlas, stores PDFs in Cloudinary, and accepts online payments through Razorpay Checkout.

## Included

- Professional responsive customer website (`/`)
- PDF submission form (one PDF per request, maximum 15 MB)
- Server-calculated price (default ₹150 per PDF)
- Razorpay Standard Checkout (UPI/cards and other methods enabled for the merchant account)
- Server-side Razorpay signature and captured-payment verification
- Razorpay webhook endpoint (`/api/payments/webhook`)
- Request ID and client request tracking (`/#track`)
- Admin dashboard (`/admin.html`)
- Admin request status updates and corrected-PDF delivery
- MongoDB Atlas persistence and Cloudinary PDF storage
- Render-ready single service

## Requirements

- Node.js 20 or later
- MongoDB Atlas database
- Cloudinary account
- Razorpay account with payment gateway activated

## Run locally

1. Extract this ZIP and open the `gg-associates-portal` folder in VS Code.
2. Open a terminal in that folder and run:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in your real credentials.
4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000` for the customer site and `http://localhost:3000/admin.html` for the admin dashboard.

## Configure services

### MongoDB Atlas

Create a database user, allow the Render service to connect in Network Access (for initial setup you may use `0.0.0.0/0`, then tighten access where practical), and copy the application connection string into `MONGODB_URI`. Replace the username, password and database name. URL-encode special characters in the password.

### Cloudinary

Copy the Cloudinary environment variable from the Cloudinary Dashboard into `CLOUDINARY_URL`. PDFs are uploaded as raw files into the `gg-associates/originals` and `gg-associates/corrected` folders.

### Razorpay

1. Activate your Razorpay payment-gateway account and complete its business/KYC requirements.
2. From Razorpay Dashboard → Account & Settings → API Keys, generate **Test Mode** keys first.
3. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env` / Render environment variables.
4. In Razorpay Dashboard, create a webhook pointing to `https://YOUR-RENDER-DOMAIN/api/payments/webhook`.
5. Subscribe to `payment.captured`, `payment.failed`, and `order.paid`; set a webhook secret and copy it to `RAZORPAY_WEBHOOK_SECRET`.
6. Enable/configure UPI and cards in your Razorpay account as applicable. Actual payment methods depend on Razorpay approval and account settings.
7. Test successful, failed and cancelled payments using Razorpay Test Mode. Only switch to Live Mode after testing and approval; replace both API keys and configure the live webhook secret.

**Important:** Keep all Razorpay secrets only in server environment variables. Never put `RAZORPAY_KEY_SECRET`, webhook secret, MongoDB URI or Cloudinary API secret in frontend code or share them in chat. The public Key ID is passed to Checkout by the server.

## Deploy to Render (single service)

1. Create a new **Web Service** in Render from your repository containing this project.
2. Runtime: Node.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add every required variable from `.env.example` under Render → Environment. Do not upload your `.env` file to a public repository.
6. Deploy. Render supplies `PORT` automatically.
7. Configure the Razorpay webhook URL using your deployed Render domain.

The app serves the frontend and backend from the same Node service. If you deploy from a ZIP, upload/extract the project to a Git repository or use a deployment method supported by Render; Render Web Services commonly deploy from a connected Git repository.

## Admin access

Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables to sign in at `/admin.html`. Change the sample password before deployment. Use a long, unique password and a strong random `JWT_SECRET` (32+ characters). Admin sessions expire after 12 hours.

## Pricing

The server controls the price through `PRICE_PER_PDF` (default `150`). The browser does not decide the amount. The current form accepts one PDF per request. For a different price, update the environment variable and redeploy/restart.

## Important launch checklist

- Replace every sample environment value.
- Use a strong unique admin password and JWT secret.
- Test with Razorpay Test Mode before Live Mode.
- Confirm UPI/card methods are enabled on the Razorpay account.
- Set the webhook secret and subscribe to the listed events.
- Review Cloudinary access settings and retention policy. The current implementation stores PDFs in Cloudinary and returns file links to the admin/customer tracking flow; treat those links as confidential and do not share them publicly.
- Add your actual WhatsApp business number to the WhatsApp link in `public/index.html` (replace the generic `https://wa.me/?text=...` link with `https://wa.me/91YOURNUMBER?text=...`).
- Add your business address, support email, privacy policy, terms, cancellation/refund policy and any required business/legal details before accepting real customer payments.
- Do not upload documents you are not authorized to edit. Avoid handling identity, financial or other highly sensitive documents unless you have an appropriate privacy and security process.

## Notes / scope

This is a ready-to-configure starter application, not a deployed/live service. No customer payments can be accepted until you supply your own approved Razorpay credentials, MongoDB and Cloudinary settings. WhatsApp is currently a contact link; automated WhatsApp messages require an approved WhatsApp Business API provider and credentials. Email notifications are not configured.
