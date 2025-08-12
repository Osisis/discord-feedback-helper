# Discord Feedback Helper (Modals + Anonymous Toggle)

A tiny helper bot that opens a form (Modal) to collect suggestions and posts them to a chosen channel. Users can choose to submit **with name** or **anonymously**.

## Quick Start

1) **Create a Discord application & bot**
   - Go to https://discord.com/developers/applications → *New Application*.
   - In **Bot** tab → *Add Bot* → Copy the **Token**.
   - In **OAuth2 → URL Generator**: Scopes = `bot`, `applications.commands`.  
     Bot Permissions = **Send Messages**, **Embed Links**, **Read Message History** (optional: Add Reactions).
   - Open the generated URL to invite the bot to your server.

2) **Gather IDs**
   - In Discord, enable **Developer Mode** (User Settings → Advanced).
   - Right‑click your server icon → **Copy Server ID** → put in `GUILD_ID`.
   - Right‑click your target suggestions channel → **Copy Channel ID** → put in `SUGGESTIONS_CHANNEL_ID`.
   - From the Developer Portal home page, copy your **Application ID** → `APP_ID`.

3) **Configure & run**
   - Copy `.env.example` to `.env` and fill in values.
   - Install Node 18+ (if not already).
   - Run:
     ```bash
     npm install
     npm start
     ```
   - You should see “Logged in as …” in the console.

4) **Use it**
   - In your server, run `/feedback` in the channel where you want users to start.
   - Click **Submit (with name)** or **Submit Anonymously**, type text, submit.
   - The bot posts an embed in your `SUGGESTIONS_CHANNEL_ID` channel.
   - Replies to users are **ephemeral** so only they see the confirmations.

### Notes on Anonymity
- If a user chooses anonymous, the posted suggestion contains **no user ID or tag**.
- The bot does receive the interaction (so the process *knows* who clicked), but this code **does not log or store** that information anywhere. If you later add logging/analytics, be mindful not to store user identifiers for anonymous submissions.

### Limit commands to one channel (optional)
- Server Settings → **Apps**/**Integrations** → choose this app → **Command Permissions** → allow `/feedback` only in your chosen channel. You can also just tell users to use `/feedback` in a specific channel; this code ignores where it's run and replies ephemerally.

---

## Customize
- Add vote buttons under the posted suggestion embed.
- Add a staff-only `/feedback-manage` command for tagging, closing, etc.
- Change the modal title or max length.

MIT License.
