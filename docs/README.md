# EventForge — Plain English Overview

> **What is EventForge?**  
> Think of EventForge as a **tracked postal service for modern software applications**. When something important happens in your business, it keeps trying to tell the right systems, records every attempt, and holds anything that still fails so you can resend it.

---

## The Everyday Problem

Modern businesses rely on dozens of different apps working together. When a customer buys something on your website, a lot needs to happen behind the scenes:

- Your payment processor needs to tell your shipping warehouse to pack the order.
- Your inventory system needs to update stock levels.
- Your accounting software needs to record the revenue.
- Your customer’s own system might want a live update.

These automated messages sent from one computer system to another across the internet are often called **webhooks** or **event notifications**.

### Where Things Go Wrong

The internet is unpredictable:

- **Computers crash**: What if the shipping warehouse’s server is restarting for an update right when the order happens?
- **Networks glitch**: What if a momentary internet blip interrupts the message halfway through?
- **Apps get overwhelmed**: What if the recipient’s system is flooded with traffic and can't answer the door?

Without a dedicated delivery system, your app is forced to wait around, hold up your customer, or worse: **the message is lost**. Orders get missed, inventory goes out of sync, and support tickets pile up.

---

## How EventForge Solves This

EventForge steps in between your main app and everyone you need to notify. It stores each message first, then delivers it in the background.

```text
 [Your Application]
        │
        │  "Here is an important update. I need you to deliver it!"
        ▼
 ╔═══════════════════════════════════════════════════════════════╗
 ║                      EVENTFORGE                               ║
 ║                                                               ║
 ║  1. Locks message safely into the vault                       ║
 ║  2. Stamps with an anti-tamper security seal                  ║
 ║  3. Dispatches message to the recipient                       ║
 ║  4. If recipient is offline, patiently waits and retries      ║
 ║  5. Records an official receipt of delivery                   ║
 ╚═══════════════════════════════════════════════════════════════╝
        │
        ▼
 [Recipient's System (Warehouse, Partner, Customer)]
```

Here is what EventForge does for your business:

### 1. Instant Handoff

When an event happens, your application hands it to EventForge and gets an answer as soon as the event is stored (a few milliseconds in local tests, see the README). Your app does not wait for third-party systems to respond.

### 2. Stored Before It Is Acknowledged

EventForge writes each message to its database before it tells you the message was accepted. If a server crashes after that point, the message is still in the database and delivery resumes when the service is back. If the database itself is lost and there is no backup, the messages are lost with it.

### 3. Patient, Automatic Retries

If a recipient’s system is down, slow, or returning errors, EventForge waits and tries again, leaving longer gaps between attempts. By default it makes 5 attempts with gaps of at most 1, 2, 4 and 8 seconds, so the default retry window is short: it covers a brief blip, not an outage. A recipient that recovers within that window gets the message without anyone doing anything; otherwise it goes to the holding room below.

### 4. A Digital Wax Seal

How does a customer or partner know a message actually came from you and wasn't faked by a scammer? EventForge signs every message with a secret that only you and the recipient know (HMAC-SHA256). The recipient can check the signature to confirm the message is authentic and unchanged.

### 5. The "Safety Net" Holding Room

If a partner’s system goes offline for an entire weekend and exhausts all normal retries, EventForge does not delete the message. It places it in a **holding room** (the dead-letter queue). Once your partner fixes their system on Monday, you click **"Replay"** on one message, or select several and replay them together, and they are sent again.

### 6. Full Delivery Tracking & Receipts

EventForge keeps a record of every delivery attempt. You can see:

- Exactly when a message was sent.
- How long it took the recipient to answer.
- Whether it succeeded on the first try or took two attempts.
- The exact reason if a delivery failed.

---

## Real-Life Comparison

| Situation                                           | Without EventForge                                                       | With EventForge                                                                                                        |
| :-------------------------------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| **Partner system goes down for 10 minutes**         | Messages are dropped. Customer orders go missing. Engineers get paged.   | EventForge retries for a few seconds, then holds the message. Once the partner is back, replay it and it is delivered. |
| **Recipient’s server is slow or lagging**           | Your main website freezes while waiting for their server to respond.     | Your website finishes instantly. EventForge handles the waiting in the background.                                     |
| **A customer claims they didn't receive an update** | You have no record of whether the message was sent or blocked.           | You pull up the timestamped record of each attempt and the response the recipient gave.                                |
| **Partner is down for days**                        | Engineers have to manually write recovery scripts or enter data by hand. | Select the held messages and replay them; EventForge sends them again.                                                 |

---

## Who Uses EventForge?

EventForge is a portfolio project, not a hosted product with customers. The kinds of teams that need this pattern are:

- **E-Commerce & Retail**: syncing orders, payments, refunds, and shipments between storefronts, warehouses, and accounting.
- **SaaS Platforms**: sending customers and integration partners live notifications.
- **Any team integrating services**: anyone who would otherwise write their own retry and recovery code.
