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
