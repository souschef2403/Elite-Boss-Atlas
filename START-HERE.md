# Elite Boss Atlas — get one shared guild link

This is the collaborative version. Everyone sees the same bosses, pin positions, screenshots and timers.

## 1. Create the shared database (Supabase)

1. Create a free Supabase project.
2. Open **SQL Editor** → **New query**.
3. Paste the full contents of `supabase-schema.sql` and press **Run**.
4. Open **Project Settings** → **API**.
5. Copy the **Project URL** and the **anon/public key**.
6. Open `config.js` and replace the two `PASTE_...` values. You may also set your guild and atlas names.

The anon key is designed for browser use. Security is enforced by the SQL row-level security policies. Never paste the `service_role` key into this project.

## 2. Deploy the site and get the Discord link

### Simplest: Vercel Drop

1. Unzip this package.
2. Complete the Supabase steps above.
3. Go to Vercel Drop in your browser.
4. Drag the **whole `elite-boss-atlas-online` folder** onto the page.
5. Vercel gives you a public URL. Post that URL in Discord and pin the message.

### Alternative: GitHub + Vercel

Upload the folder to a GitHub repository, then import the repository into Vercel. Future GitHub changes deploy automatically.

## 3. Allow guild members to edit

1. Members open the deployed URL.
2. They press **Guild sign in** → **Create account**.
3. Once signed in, they can add/edit bosses, drag pins, upload images and use **Seen now**.
4. Public visitors can view but cannot edit.

After your guild members have registered, you can stop strangers registering: in Supabase open **Authentication → Providers → Email** and disable new sign-ups. Existing accounts keep working.

## 4. Important Supabase URL settings

In **Authentication → URL Configuration**:

- Set **Site URL** to the Vercel URL.
- Add the same Vercel URL under **Redirect URLs**.

This is especially important when email confirmation is enabled.

## 5. Move markers

Sign in, press **🔒 Pins locked** so it changes to **🔓 Pins unlocked**, then drag any marker. Its new position saves to Supabase and appears for all members. While unlocked, clicking an empty map location opens the Add Boss form.

## 6. Bring data from the old local version

Use **Export** in the old atlas. In the new online atlas, sign in and press **Import**. The importer accepts the old JSON format and shares the imported records with everyone.

## Admin note

The starter permissions allow any authenticated member to edit/delete. For a trusted guild this is convenient. For stricter moderation, add an `atlas_admins` table and admin-only delete/approval policies later.
