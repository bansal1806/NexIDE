# NexIDE auth emails

Six emails in the Playground style. They're built from one layout by `build.mjs`, so to change the wording or colours, edit that file and run:

```sh
node supabase/templates/build.mjs
```

The templates are email-safe:

- tables and inline styles only
- no images, web fonts, scripts or `box-shadow`
- the chunky "shadow" is a thicker right/bottom border

They're built to hold up in Gmail, Outlook and Apple Mail, and on phones. So far they've only been rendered in a browser (desktop and 375 px), so send yourself a test to see them in your own inbox.

## Install them in Supabase

1. Open **Supabase dashboard → Authentication → Emails → Templates**.
2. For each email below, pick it in the list, set the **Subject**, and replace the **Body** with the whole contents of its `.html` file. Click **Save**.

| Supabase template | File | Subject |
| --- | --- | --- |
| Confirm sign up | `confirm-signup.html` | 🎈 One click and you're in — welcome to NexIDE! |
| Invite user | `invite.html` | 🎟️ You've got an invite to NexIDE |
| Magic link | `magic-link.html` | ✨ Your magic NexIDE sign-in link |
| Change email address | `change-email.html` | 📮 Confirm your new NexIDE email |
| Reset password | `reset-password.html` | 🔑 Let's get you back into NexIDE |
| Reauthentication | `reauthentication.html` | 🛡️ Your NexIDE verification code |

Subjects are also in `subjects.json`.

## Sending to real users: set up SMTP

Supabase's built-in email service is meant for testing. It is heavily rate-limited, and it only delivers to the email addresses of your Supabase project's team members. Anyone else who signs up gets no email.

For real users, connect your own email provider:

1. Open **Authentication → Emails → SMTP Settings**.
2. Enter the SMTP details from your provider (for example Resend, Postmark or SendGrid).
3. Set the sender name to **NexIDE**.

The templates work the same with any provider.

## Variables

Supabase fills in these placeholders when it sends an email:

| Placeholder | Value |
| --- | --- |
| `{{ .ConfirmationURL }}` | the action link |
| `{{ .Token }}` | the one-time code |
| `{{ .Email }}` | the user's address |
| `{{ .NewEmail }}` | the new address (change email only) |
| `{{ .SiteURL }}` | your Site URL |

`templates.test.js` checks that every template keeps the variables it needs, and that the HTML matches `build.mjs`.
