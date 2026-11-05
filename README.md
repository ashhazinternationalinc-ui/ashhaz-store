ASHHAZ STORE — ADMIN PANEL UPDATE

Included in this package:
- Admin login at /admin.html (existing secure cookie-session login retained)
- Dashboard cards for products, orders, sales, online paid, COD pending and low stock
- Order search and filters
- Order details including ordered items and Razorpay IDs
- Order status update: New, Processing, Shipped, Delivered, Cancelled, Returned, Pending Payment
- Product add/edit/hide, active/inactive listing and stock quantity editing
- Customer summary based on order records
- Date-filtered sales/order report and CSV exports
- Admin-only product listing and order APIs
- Existing COD order creation preserved
- Razorpay checkout field names and success amount display aligned with the existing payment API response

DEPLOYMENT
1. Upload/replace these project files in the existing GitHub repository:
   - admin-dashboard.html
   - index.html
   - functions/api/orders.js
   - functions/api/products.js
   - README.md
2. Keep the existing admin.html, functions/api/login.js, functions/api/logout.js and functions/_lib/auth.js.
3. Commit to the same branch used by Cloudflare Pages and wait for a successful production deployment.
4. Cloudflare Pages must already have these secrets configured:
   - ADMIN_PASSWORD
   - SESSION_SECRET (at least 32 characters)
   - RAZORPAY_KEY_ID
   - RAZORPAY_KEY_SECRET
   Never put secret values in GitHub or share them in chat.
5. No D1 migration is required by this update.

IMPORTANT NOTES
- Order status changes do not automatically restore inventory for Cancelled/Returned orders. Inspect the physical return first, then adjust stock from Products & Stock.
- Customer list is derived from order records; it does not create a separate customer master.
- Reports use the latest 500 orders returned by the API. They are not a GST, payout, refund or profit-and-loss ledger.
- Razorpay refund processing is not included; mark the order appropriately only after handling any refund in Razorpay.

## Shipkia + refunds update (2026-11-05)

This update adds admin-only Shipkia operations at `/api/shipkia` and refund/courier controls in the order detail panel.

### Required D1 migration
Run `migrations/0002_shipkia.sql` once against the existing `ashhaz_store_db` D1 database before deploying. It adds Shipkia order/AWB/courier status columns.

### Required Cloudflare secrets
Configure these as Pages environment variables/secrets (Production, and Preview only if testing there):
- `SHIPKIA_API_KEY` — Shipkia API key (Secret; never put it in source code)
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` — existing Razorpay credentials (Secrets)

Pickup details used by this project: Ashhaz International Inc, BP-38, Ekta Vihar Colony, Rampur Road, Moradabad, Uttar Pradesh 244001, contact 7906073233. Shipkia account must already have this pickup address registered and active; `pickup_address` in its API request is the saved pickup-address name/identifier expected by Shipkia. Set optional `SHIPKIA_PICKUP_NAME` to the exact pickup address name in Shipkia if it differs from “Ashhaz International Inc”.

### Admin workflow
1. Open an order in Admin Dashboard.
2. Click **Create Shipkia Order** once. This sends the customer and item data to Shipkia.
3. Click **Get Courier Quote** and inspect the response/charges.
4. Choose a returned `quote_id`, then click **Book Shipment (AWB)** and paste it.
5. Click **Track Shipment** to retrieve tracking timeline.
6. For prepaid Razorpay orders, **Accept & Refund** sends a real refund request. For COD/manual orders it only records that a manual refund is required; money must be transferred separately.

Important: Shipkia's published Create Order Open API example specifies an XML body while showing `Content-Type: application/json`; this implementation follows the published cURL example. The Shipkia account's pickup address, request acceptance, rates and booking must be verified with a controlled test order before using it for live customer orders. Product dead weight/dimensions currently use conservative placeholders (0.5 kg, 1x1x1 cm) and must be replaced with actual package values before production booking. Courier quote is displayed for operator review; it is not silently charged to customers.
