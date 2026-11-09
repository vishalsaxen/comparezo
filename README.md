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

Categories and sub-categories are stored in the database, not in code, so they can be changed while the app runs. They follow the same shape as giazonest: each category has a list of sub-categories, and "Other" always sorts last. The app starts with **Fashion & Clothing** (Men's Wear, Women's Wear, Kids' Wear, Footwear, Bags & Accessories, Leather, Other) plus the earlier top-level categories. It also imports GiaZoNest's full list (`server/category-sets/giazonest.js`): 21 categories, 141 sub-categories and 117 types (sub-sub-categories, used by School & Education), such as Home & Kitchen, Doctors, Real Estate and School & Education › Music › Sitar.

Starting categories come in sets (`SETS` in `server/categories.js`). Each set is added once, the first time the app starts with it, and the `category_sets` table remembers which ones were added, so a category you delete doesn't come back. To add more starting categories, append a new set.

To edit them, set an `ADMIN_KEY` environment variable on the server, open `/categories.html` (linked as "Manage categories" in the footer), and enter the key. You can add, rename, reorder and delete categories and sub-categories there. Renaming also updates existing products and listings. A category that is still used by a product or listing can't be deleted. Without `ADMIN_KEY`, editing is turned off.

Sellers pick a sub-category when the category has them, and a type when the sub-category has types. Shoppers can narrow search results by sub-category and type. Products and listings store these in `category`, `sub_category` and `type`.

## Getting real prices

The prices in this app are sample data. Real prices need each store's official partner feed, for example the Amazon Associates Product Advertising API or the Flipkart Affiliate API. Copying prices off store websites is against most stores' terms. Each feed would write into the `offers` table. Each feed would also store the exact product link in `offers.url`.

## New arrivals from store feeds

The Comparezo tab has a **New arrivals, last 20 days** section (`GET /api/new-arrivals?days=20&store=&category=`). It fills from the stores' official partner APIs. Nothing is scraped. Each feed turns on only when its keys are set as environment variables, and feeds refresh every `FEED_INTERVAL_HOURS` (default 6). `GET /api/feeds` shows which feeds are connected and the last run. `POST /api/admin/feeds/run` with the `X-Admin-Key` header runs them now.

Stores don't publish an "uploaded on" date, so a product's arrival date is its store release date when the feed gives one, otherwise the moment Comparezo first saw it (`feed_seen` table).

| Store | How new products are found | Environment variables |
| --- | --- | --- |
| Flipkart | Affiliate API Delta Feed. The first run saves the current catalogue as a baseline (not new). Later runs add products whose id was never seen before. | `FLIPKART_AFFILIATE_ID`, `FLIPKART_AFFILIATE_TOKEN`, optional `FLIPKART_CATEGORIES` (JSON map of Flipkart category to `[category, sub-category]`) |
| Amazon.in | Creators API (replaced PA-API 5 in 2026) `searchItems` sorted by `NewestArrivals`, using `releaseDate` when present | `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, `AMAZON_PARTNER_TAG`, optional `AMAZON_SEARCHES` (JSON list), `AMAZON_TOKEN_URL`, `AMAZON_API_BASE`, `AMAZON_MARKETPLACE` |
| Meesho | No public product or affiliate API, so not connected | none |

Defaults for the Flipkart categories and Amazon searches are in `server/feeds/index.js`. The "first seen" history lives in the database, so the app needs storage that survives restarts for these dates to be right.

## Buying

"Buy on <store>" opens that store in a new tab. If the offer has a product link (`offers.url`), it opens that link. Otherwise it opens the store's own search for the product name (see `server/stores.js`). Comparezo doesn't take payment itself. For an individual seller, "Contact seller" shows their name, city and phone so the buyer can deal with them directly.

For now, each of those clicks is counted as a purchase for Linezo. In production this should come from the affiliate network's order reports, so Linezo reflects real orders.
