# ClassCards

Flashcards for any class. It has **Google sign-in**, a **local SQLite database**, **multiple classes**, and **custom card layouts**.

- **Classes**: each class (APUSH, AP Bio, Spanish…) has its own name, color, and card layout. It ships with a built-in **APUSH** class that has 98 cards (Periods 1–3).
- **Layouts** set which fields a card has and where each one shows. There are 5 built-in layouts: APUSH, Term & Definition, Vocabulary, Question & Answer, and Formula. You can also build your own or duplicate and change a built-in one.
- **Make and save cards**: sign in with Google, pick a class, and click **+ New card**. You get a live preview while you type. Your cards and classes are private to your account.
- Search, section filters (from the layout's "Sections" fields), a year filter (for Date fields), and Study Mode with shuffle (← → move, Space flip, Esc close).
- **Export my cards** (footer) downloads everything you made as JSON.

The original static APUSH page is kept in `legacy/index.html`.

## Layouts
Each field has:

| Setting | Options |
|---|---|
| Type | Short text · Long text (supports color markup) · Number · Date / year |
| Shows on | Front – big · Front – small line · Back – top line ("Label: value") · Back – main text |
| Sections | Groups cards into headed sections and adds a filter (Number or Short text; up to 3) |

Color markup in long text: `**key term**` → blue, `!!core fact!!` → red, `__significance__` → purple.

You can edit a layout after cards use it. Renaming or reordering fields keeps the card data. A class's layout can only be switched while the class has no cards.

## Run locally
```bash
npm install
cp .env.example .env      # fill in values (see below)
npm start                 # http://localhost:3000
```
To test without Google, run `npm run dev`, then click **Dev sign-in**. It's disabled when `NODE_ENV=production`.

## Google OAuth setup
1. Go to https://console.cloud.google.com and create or pick a project.
2. Open **APIs & Services → OAuth consent screen**. Choose External, add the scopes `openid`, `email`, and `profile`, and add yourself as a test user (or publish the app).
3. Open **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `<BASE_URL>/auth/google/callback`. For example:
   `http://localhost:3000/auth/google/callback` or `https://cards.yourdomain.com/auth/google/callback`
4. Put the client ID and secret in `.env`, and set `BASE_URL` to the exact URL people use.

`ALLOWED_EMAILS` (optional) limits sign-in to a comma-separated list of accounts.

> Google only allows `http://` for `localhost`. For anything else, use HTTPS on a real domain, for example with Caddy, nginx, or a Cloudflare Tunnel in front of the LXC.

## Deploy in a Proxmox LXC (Debian 12 / Ubuntu 24.04)
```bash
git clone https://github.com/coolguy1333/Cards.git && cd Cards
sudo ./deploy/install-lxc.sh             # installs Node 22, copies the app to /opt/classcards, sets up the systemd service
sudo nano /opt/classcards/.env           # set BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
sudo systemctl restart classcards
journalctl -u classcards -f
```
To update, run `git pull && sudo ./deploy/install-lxc.sh`. Your `.env` and database are kept.

The database is at `/var/lib/classcards/classcards.db`. To back it up:
```bash
sqlite3 /var/lib/classcards/classcards.db ".backup '/root/classcards-$(date +%F).db'"
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/me` | – | Current user and sign-in config |
| GET / POST | `/api/layouts` | POST ✔ | List (built-in + yours) / create |
| PUT / DELETE | `/api/layouts/:id` | ✔ owner | Edit / delete (blocked while a class uses it) |
| GET / POST | `/api/classes` | POST ✔ | List / create |
| PUT / DELETE | `/api/classes/:id` | ✔ owner | Edit / delete (deletes its cards) |
| GET / POST | `/api/classes/:id/cards` | POST ✔ | Cards in a class / add a card |
| PUT / DELETE | `/api/cards/:id` | ✔ owner | Edit / delete a card |
| GET | `/api/export` | ✔ | Your layouts, classes, and cards as JSON |

## Files
```
server.js              Express app: Google OAuth, sessions, API
db.js                  SQLite schema, built-in layouts, APUSH seed
seed/apush-cards.json  Built-in APUSH cards
public/                index.html, app.js, style.css
deploy/                install-lxc.sh, classcards.service
legacy/index.html      Original static APUSH page
```
