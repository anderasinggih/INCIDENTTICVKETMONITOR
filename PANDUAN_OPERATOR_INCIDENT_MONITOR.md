# Operator Guide: Incident Ticket Monitor Update

Simple briefing slides for NOC operators on the new features in **Incident Ticket Monitor** and important rules to prevent data overwrite.

---

## Slide 1: What's New? (1/2)

### 1. Auto-Add Ticket from Handle TT (TT9)
- When you click **Submit** on the Handle TT form (TT9), tickets with **FTTH** or **FWA** domain will automatically be added to **Incident Ticket Monitor**.
- Non-FTTH/FWA tickets are automatically skipped without any error popup.

> **[ 📸 SCREENSHOT PLACEHOLDER 1 ]**
> *Take a screenshot of: Form Handle TT (TT9) highlighting the **Submit** button, and an arrow pointing to the ticket appearing on the **Incident Ticket Monitor** dashboard.*
> `![Auto Add from TT9](./screenshots/slide1_auto_add_tt9.png)`

### 2. Two-Way Sync (Incident Monitor ↔ Main Ticket)
- Dashboard cards now read **live data** directly from the main OWS Trouble Ticket.
- When you edit and click **Save** in Incident Monitor, these fields are automatically updated in the main OWS ticket too:
  - **Action Timeline / Incident Chronology**
  - **PIC Contractor (Responsibility)**
  - **Escalation Level & Support Status**

> **[ 📸 SCREENSHOT PLACEHOLDER 2 ]**
> *Take a screenshot of: The **View & Edit Details** popup in Incident Monitor side-by-side with the **Main Ticket (Common Query)** showing the same updated Action Chronology & PIC.*
> `![Two-Way Sync](./screenshots/slide1_two_way_sync.png)`

---

## Slide 2: What's New? (2/2)

### 3. Escalation Level & Need Support
- You can now update **Escalation Level (Level 1 to 5)** and **Need Support / No Need Support** directly from the Incident Monitor edit popup.
- Every update is saved into the **Escalation Log** (with timestamp, notes, and operator name) and automatically appears on the OWS Ticket Flow form (TT11).
- Built-in **anti-reset protection**: the escalation level can only go up and will not accidentally reset to 0.

> **[ 📸 SCREENSHOT PLACEHOLDER 3 ]**
> *Take a screenshot of: Escalation Level & Support section inside the Incident Monitor popup + the **Escalation Level / Support** fields displayed on the OWS TT11 Flow form.*
> `![Escalation Feature](./screenshots/slide2_escalation_feature.png)`

### 4. PMA Ticket Support & Dashboard Improvements
- **PMA Tickets (`PMA-xxxx`):** Now supported on the dashboard (shown with an **orange badge**). Updating the *Action* field on a PMA card automatically updates *Resolution Notes* in the main PMA ticket.
- **No More 8-Ticket Limit:** You can monitor all active tickets without quota restrictions.
- **Auto-Sort by Aging:** Tickets with the longest aging time are automatically placed at the top.
- **Auto-Hide When Cleared:** Once a ticket is *Closed / Completed* or its *Clear Time* (Fault Recovery Time) is filled, the card is automatically removed from the active monitor.

> **[ 📸 SCREENSHOT PLACEHOLDER 4 ]**
> *Take a screenshot of: The main dashboard showing an **Orange PMA Card**, **Impact Site List** on an INC card, and tickets sorted by longest Aging Time.*
> `![Dashboard Card Updates](./screenshots/slide2_dashboard_cards.png)`

---

## Slide 3: ⚠️ IMPORTANT — What NOT To Do!

### DO NOT Open & Save the Same Ticket in 2 Places at the Same Time Without Refreshing!

**Common Mistake Scenario:**
1. You open ticket `INC-xxx` in **Common Query / OWS Ticket Form** (Tab 1).
2. At the same time, you open the edit popup for `INC-xxx` in **Incident Ticket Monitor** (Tab 2).
3. You add a new *Action Log* in **Incident Monitor** (Tab 2) and click **Save**.
4. Then, you switch back to **Common Query** (Tab 1) — which was already open — and click **Save / Submit** without refreshing the page first.

**What Happens:**
> Your new update from Incident Monitor **WILL BE OVERWRITTEN (LOST)** by the old data still sitting on your Common Query screen!

> **[ 📸 SCREENSHOT PLACEHOLDER 5 ]**
> *Take a screenshot of: Two browser tabs side-by-side — Tab 1 showing **Common Query (Ticket Detail)** and Tab 2 showing **Incident Ticket Monitor (Edit Popup)** for the exact same `INC-xxx` ticket, marked with a red ❌ warning.*
> `![Don't Edit in Two Tabs Without Refresh](./screenshots/slide3_dont_overwrite.png)`

---

## Slide 4: Why Does Data Overwrite Happen?

```text
[10:00] You open the ticket in Common Query (Tab 1) & Incident Monitor (Tab 2)
        Both screens hold the same old data (payload):
        Chronology = "10:00 - Alarm checked"
           │
           ▼
[10:15] You type & click Save in Incident Monitor (Tab 2):
        Database is updated to:
        Chronology = "10:00 - Alarm checked + 10:15 - Team on the way"
           │
           ▼
[10:20] You go back to Common Query (Tab 1) WITHOUT REFRESHING and click Save:
        Tab 1 still holds the old 10:00 payload on the interface and sends it to the server!
        --> Result: The "10:15 - Team on the way" update is OVERWRITTEN and LOST.
```

- Any page or popup that is already open in your browser still holds the **old data (old payload)** from the moment you opened it.
- If you click **Save** without refreshing, the interface sends that old payload back to the database and overwrites the newer data.
- **This happens both ways:** Common Query can overwrite Incident Monitor, and an old open popup in Incident Monitor can overwrite Common Query.

---

## Slide 5: Safe Working Rules for Operators (SOP)

1. **Always Refresh Before Editing in Another Tab**
   - After clicking **Save** in **Incident Monitor** → **REFRESH** the **Common Query / Ticket Form** tab first before editing or saving anything there.
   - After clicking **Save** in **Common Query / Ticket Form** → **Close and re-open** the **View & Edit Details** popup in Incident Monitor so it loads the latest data.

> **[ 📸 SCREENSHOT PLACEHOLDER 6 ]**
> *Take a screenshot of: Browser refresh button / OWS page refresh on Common Query, and the **Close (✕) → View & Edit Details** button in Incident Monitor marked with a green ✅.*
> `![Refresh Before Save SOP](./screenshots/slide5_safe_sop.png)`

2. **Do Not Leave the Edit Popup Open for Too Long**
   - Only open **View & Edit Details** in Incident Monitor when you are ready to type your update, then click **Save** right away.
   - Never leave the edit popup open in the background for a long time and click Save later.

3. **One Operator at a Time per Ticket**
   - Coordinate with your shift teammates so two operators are not editing and saving the same ticket number at the exact same time.
