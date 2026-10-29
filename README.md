# Nasdaq Signal Board

A static web page that scores 12 Nasdaq leaders (MSFT, NVDA, GOOG, AMZN, META, AVGO, TSLA, AMD, MU, INTC, MRVL, PLTR) with a composite trend / momentum / mean-reversion model, and shows signals, stops, position sizes and a backtest.

GitHub rebuilds and republishes it every weekday from the latest daily closes. Prices come from the public dataset at https://github.com/yennanliu/finance_data.

## Put it online (about 5 minutes, free)

1. Create a new repository on github.com (for example `nasdaq-signal-board`). It can be public or private; private needs a paid GitHub plan for Pages.
2. Upload every file and folder from this zip to the repository, keeping the `.github` folder.
   On the web: **Add file → Upload files**, drag the contents in, then **Commit changes**.
   If the `.github` folder doesn't upload, create the file `.github/workflows/update.yml` with **Add file → Create new file** and paste its contents in.
3. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Go to **Actions → Update signal board → Run workflow** to build it the first time.
5. Your page appears at `https://<your-username>.github.io/<repository-name>/`.

After that it updates by itself at 11:15 UTC (15:15 Mauritius), Tuesday to Saturday, each time showing the previous US trading day's close.

## Change the stocks or rules

- Stocks: edit the `UNIVERSE` list at the top of `scripts/build.js`. A ticker must exist as a file in the dataset's `data/prices` folder.
- Rules and weights: edit `P` at the top of `scripts/engine.js`.
- Build locally: `bash scripts/update.sh index.html --standalone` (needs git and Node 18+), then open `index.html` in a browser.

Educational research tool, not investment advice.
