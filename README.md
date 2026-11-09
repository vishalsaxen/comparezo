# Comparezo

Comparezo helps shoppers in India find the cheapest place to buy. One search shows a product's price on Meesho, Amazon.in, Flipkart, Myntra, JioMart, Snapdeal and others side by side. The cheapest store is worked out from what you actually pay: listed price plus delivery, minus coupons. Individuals can also list their own products for sale.

The app has two tabs:

- **Comparezo**: search, compare prices, buy where it's cheapest, and sell your own product.
- **Linezo**: sales trends built from customer purchases. It shows units sold per day with a 7-day average, sales value, the stores people buy from, top categories and best sellers. You can filter by 7, 30 or 90 days and by category.

## Run it

You need Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is no database to install.

```bash
npm install
npm start          # http://localhost:3000
npm test
```

On first start the app creates `data/comparezo.db` and fills it with sample products, sample prices and 120 days of sample purchases, so Linezo has something to show. Delete the `data/` folder to start fresh. You can set `PORT` and `DATA_DIR` to change the port and data location.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Server | `server/app.js` | JSON API built with Express |
| Database | `server/db.js` | Tables: `products`, `offers` (one row per store price), `listings` (individual sellers), `purchases`, `categories` |
| Cheapest price | `server/pricing.js` | You pay = price + delivery − coupon. If two stores tie, the faster delivery wins. |
| Linezo trends | `server/trends.js` | Daily units and revenue, change compared with the previous period, store and category share, best sellers |
| Front end | `public/` | Plain HTML, CSS and JS with no build step. `#compare` and `#linezo` switch tabs. |

### API

- `GET /api/products?q=&category=`: search products, each with its lowest price
- `GET /api/products/:id?extras=1`: all store offers, the cheapest one, and how much you save
- `GET /api/listings` and `POST /api/listings`: individual seller listings. Photos are sent as data URLs, up to 3 MB.
- `POST /api/purchases` with `{offerId}` or `{listingId}`: records a purchase, which feeds Linezo
- `GET /api/trends?days=30&category=`: the data behind Linezo
- `GET /api/categories`: the category tree, each category with its `subcategories`
- `POST /api/categories` with `{name, parentId?}`, `PATCH /api/categories/:id` with `{name}` or `{move: "up"|"down"}`, and `DELETE /api/categories/:id`: edit categories. These need the `X-Admin-Key` header.

## Categories

Categories and sub-categories are stored in the database, not in code, so they can be changed while the app runs. They follow the same shape as giazonest: each category has a list of sub-categories, and "Other" always sorts last. The app starts with **Fashion & Clothing** (Men's Wear, Women's Wear, Kids' Wear, Footwear, Bags & Accessories, Leather, Other) plus the earlier top-level categories.

To edit them, set an `ADMIN_KEY` environment variable on the server, open `/categories.html` (linked as "Manage categories" in the footer), and enter the key. You can add, rename, reorder and delete categories and sub-categories there. Renaming also updates existing products and listings. A category that is still used by a product or listing can't be deleted. Without `ADMIN_KEY`, editing is turned off.

Sellers pick a sub-category when the category has them, and shoppers can narrow search results by sub-category.

## Getting real prices

The prices in this app are sample data. Real prices need each store's official partner feed, for example the Amazon Associates Product Advertising API or the Flipkart Affiliate API. Copying prices off store websites is against most stores' terms. Each feed would write into the `offers` table. Each feed would also store the exact product link in `offers.url`.

## Buying

"Buy on <store>" opens that store in a new tab. If the offer has a product link (`offers.url`), it opens that link. Otherwise it opens the store's own search for the product name (see `server/stores.js`). Comparezo doesn't take payment itself. For an individual seller, "Contact seller" shows their name, city and phone so the buyer can deal with them directly.

For now, each of those clicks is counted as a purchase for Linezo. In production this should come from the affiliate network's order reports, so Linezo reflects real orders.
