# Comparezo

Comparezo helps shoppers in India find the cheapest place to buy. One search shows a product's price on Meesho, Amazon.in, Flipkart, Myntra, JioMart, Snapdeal and others side by side. The cheapest store is worked out from what you actually pay: listed price plus delivery, minus coupons.

The app has two tabs:

- **Comparezo**: search, compare prices, buy where it's cheapest, and sell your own product.
- **Linezo**: the owner's sales tracker. It counts every "Buy" click: clicks per day with a 7-day average, the value of the clicked items, which stores and categories get the clicks, and the most clicked products. Confirmed orders and commission are in the Cuelinks dashboard. You can filter by 7, 30 or 90 days and by category.

## Run it

You need Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is no database to install.

```bash
npm install
npm start          # http://localhost:3000
npm test
```

On first start the app creates `data/comparezo.db` with the categories, then loads the products in `server/catalog.json`. There is no sample data. Delete the `data/` folder to start fresh. You can set `PORT` and `DATA_DIR` to change the port and data location.

## Saving data in Firebase Firestore

Render's free plan wipes the disk on every restart. To keep products, categories and Linezo clicks, connect Firestore (free on Firebase's Spark plan):

1. In the [Firebase console](https://console.firebase.google.com), create a project and open **Build → Firestore Database → Create database** (production mode, location `asia-southeast1` to sit next to the Render server).
2. **Project settings → Service accounts → Generate new private key** downloads a JSON key file. Keep it private and never commit it.
3. On Render, add an environment variable `FIREBASE_SERVICE_ACCOUNT` whose value is the whole JSON file (base64 of it also works). Locally you can instead set `GOOGLE_APPLICATION_CREDENTIALS` to the file's path.

How it works (`server/firestore-sync.js`): the app still uses SQLite while running. On start it copies every table from Firestore into SQLite. After any request that changes data (and every 5 minutes, and on shutdown) it writes only the rows that changed to Firestore, and deletes rows that were removed. Each table is a sub-collection under the document `comparezo/main` (change it with `FIRESTORE_ROOT`, e.g. `comparezo/dev` for testing). The first start with an empty Firestore uploads everything, about 290 writes.

If Firestore can't be read on start (for example a wrong key), the app still starts but saving is turned off, so it can never overwrite good data with an empty database. Check the Render logs for a line starting with `Firestore`.

Spark limits are 20,000 writes and 50,000 reads a day. Each restart reads every row once, and each Buy click is one write. If store feeds are turned on later, their `feed_seen` history can be large, so watch the usage page in Firebase.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Server | `server/app.js` | JSON API built with Express |
| Database | `server/db.js` | Tables: `products`, `offers` (one row per store price), `purchases`, `categories` |
| Cheapest price | `server/pricing.js` | You pay = price + delivery − coupon. If two stores tie, the faster delivery wins. |
| Linezo trends | `server/trends.js` | Daily units and revenue, change compared with the previous period, store and category share, best sellers |
| Front end | `public/` | Plain HTML, CSS and JS with no build step. `#compare` and `#linezo` switch tabs. |

### API

- `GET /api/products?q=&category=`: search products, each with its lowest price
- `GET /api/products/:id?extras=1`: all store offers, the cheapest one, and how much you save
- `POST /api/purchases` with `{offerId}`: records a Buy click, which feeds Linezo
- `GET /api/trends?days=30&category=`: the data behind Linezo
- `GET /api/categories`: the category tree, each category with its `subcategories`
- `POST /api/categories` with `{name, parentId?}`, `PATCH /api/categories/:id` with `{name}` or `{move: "up"|"down"}`, and `DELETE /api/categories/:id`: edit categories. These need the `X-Admin-Key` header.

## Categories

Categories and sub-categories are stored in the database, not in code, so they can be changed while the app runs. They follow the same shape as giazonest: each category has a list of sub-categories, and "Other" always sorts last. The app starts with **Fashion & Clothing** (Men's Wear, Women's Wear, Kids' Wear, Footwear, Bags & Accessories, Leather, Other) plus the earlier top-level categories. It also imports GiaZoNest's full list (`server/category-sets/giazonest.js`): 21 categories, 141 sub-categories and 117 types (sub-sub-categories, used by School & Education), such as Home & Kitchen, Doctors, Real Estate and School & Education › Music › Sitar.

Starting categories come in sets (`SETS` in `server/categories.js`). Each set is added once, the first time the app starts with it, and the `category_sets` table remembers which ones were added, so a category you delete doesn't come back. To add more starting categories, append a new set.

To edit them, set an `ADMIN_KEY` environment variable on the server, open `/categories.html` (linked as "Manage categories" in the footer), and enter the key. You can add, rename, reorder and delete categories and sub-categories there. Renaming also updates existing products. A category that is still used by a product can't be deleted. Without `ADMIN_KEY`, editing is turned off.

Products pick a sub-category when the category has them, and a type when the sub-category has types. Shoppers can narrow search results by sub-category and type. Products store these in `category`, `sub_category` and `type`.

## Getting real prices

Prices come from products added by hand (see below) or from store feeds. Automatic prices need each store's official partner feed, for example the Amazon Associates Product Advertising API or the Flipkart Affiliate API. Copying prices off store websites is against most stores' terms. Each feed would write into the `offers` table. Each feed would also store the exact product link in `offers.url`.

## New arrivals from store feeds

The Comparezo tab has a **New arrivals, last 20 days** section (`GET /api/new-arrivals?days=20&store=&category=`). It fills from the stores' official partner APIs. Nothing is scraped. Each feed turns on only when its keys are set as environment variables, and feeds refresh every `FEED_INTERVAL_HOURS` (default 6). `GET /api/feeds` shows which feeds are connected and the last run. `POST /api/admin/feeds/run` with the `X-Admin-Key` header runs them now.

Stores don't publish an "uploaded on" date, so a product's arrival date is its store release date when the feed gives one, otherwise the moment Comparezo first saw it (`feed_seen` table).

| Store | How new products are found | Environment variables |
| --- | --- | --- |
| Flipkart | Affiliate API Delta Feed. The first run saves the current catalogue as a baseline (not new) and adds the first 40 in-stock products of each category to the site as normal products. Later runs add products whose id was never seen before. | `FLIPKART_AFFILIATE_ID`, `FLIPKART_AFFILIATE_TOKEN`, optional `FLIPKART_CATEGORIES` (JSON map of Flipkart category to `[category, sub-category]`) |
| Amazon.in | Creators API (replaced PA-API 5 in 2026) `searchItems` sorted by `NewestArrivals`, using `releaseDate` when present | `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, `AMAZON_PARTNER_TAG`, optional `AMAZON_SEARCHES` (JSON list), `AMAZON_TOKEN_URL`, `AMAZON_API_BASE`, `AMAZON_MARKETPLACE` |
| Meesho | No public product or affiliate API, so not connected | none |

Defaults for the Flipkart categories and Amazon searches are in `server/feeds/index.js`. The "first seen" history lives in the database, so connect Firestore for these dates to survive restarts.

## Adding products by hand

Store APIs are hard to get, so you can also add products yourself. Open `/products.html` (linked as "Add products" in the footer) and enter the `ADMIN_KEY`. Fill in a product, its category, and for each store its price and product link. These links earn commission through Cuelinks like any other store link.

With Firestore connected (see above), products added on that page are kept across restarts. Without it they are wiped when the free Render server restarts; in that case click **Copy list** and add the result to `server/catalog.json`. Every product in that file loads on start (`server/catalog.js`), and `npm test` checks the file is valid.

## Earning commission with Cuelinks

Set `CUELINKS_CID` to the number from the Cuelinks JavaScript code (Dashboard → Installation → JavaScript). The page then loads `/affiliate.js`, which loads Cuelinks' script. When a shopper clicks "Buy on Flipkart", "Buy on Myntra" and so on, Cuelinks turns the link into a commission-earning link for any store you're approved for. Without `CUELINKS_CID`, `/affiliate.js` does nothing.

## Buying

"Buy on <store>" opens that store in a new tab. If the offer has a product link (`offers.url`), it opens that link. Otherwise it opens the store's own search for the product name (see `server/stores.js`). Comparezo doesn't take payment itself.

Each of those clicks is counted in Linezo. Without Firestore connected, the click history is wiped when the free Render server restarts. Confirmed orders come from Cuelinks' own reports.
