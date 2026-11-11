# Proposal Perombakan Escalation Level: `1–5` ➔ `0–3` (Zero-Fallback Architecture)

Dokumen ini berisi rencana teknis lengkap untuk merombak definisi **Escalation Level** dari **5 level (`1, 2, 3, 4, 5`)** menjadi **4 level (`0, 1, 2, 3`)** dengan menghapus **Level 5** serta menerapkan prinsip **Zero-Fallback** (tanpa fallback ke kolom atau tabel warisan) di seluruh project Huawei OWS.

---

## 1. Skema Mapping Definisi Baru

| Skema Lama (5 Level) | Skema Baru (4 Level) | Threshold Blinking (SLA Aging) | Warna Indikator / Badge | Format Tag Chronology |
| :--- | :--- | :--- | :--- | :--- |
| Belum Eskalasi (`0` / `null`) | **No Escalation (`null`)** | — | Abu-abu / Muted | — |
| `Level 1` | **`Level 0`** | `> 30 menit` (`0.5 jam`) | Teal (`#0d9488` / `#14b8a6`) | `[ESCALATION LEVEL 0]` |
| `Level 2` | **`Level 1`** | `> 90 menit` (`1.5 jam`) | Biru (`#0284c7` / `#38bdf8`) | `[ESCALATION LEVEL 1]` |
| `Level 3` | **`Level 2`** | `> 170 menit` (`~3 jam`) | Kuning/Amber (`#eab308` / `#facc15`) | `[ESCALATION LEVEL 2]` |
| `Level 4` | **`Level 3`** | `> 230 menit` (`~4 jam`) | Merah/Oranye (`#dc2626` / `#f87171`) | `[ESCALATION LEVEL 3]` |
| `Level 5` | **DIHAPUS** | *(Dihapus, sebelumnya `> 470m`)* | *(Dihapus)* | *(Dihapus)* |

---

## 2. Arsitektur Zero-Fallback & Pemisahan State `null` vs `0`

### A. Mengapa State `No Escalation` Harus `null` (Bukan `0`)
Pada kode lama, angka `0` dipakai sebagai penanda **"Belum Eskalasi (No Escalation)"** (`Number(lvl || 0)`, `if (lvl > 0)`, `if (!targetLevel)`).
Karena sekarang **`Level 0`** adalah level eskalasi pertama yang aktif:
- **Belum Eskalasi (`No Escalation`):** Wajib direpresentasikan dengan **`null`**.
- **Sudah Eskalasi:** Direpresentasikan dengan angka integer **`0, 1, 2, 3`** (`lvl !== null && lvl >= 0 && lvl <= 3`).

### B. Prinsip Zero-Fallback (Single Source of Truth)
1. **Sumber Kebenaran Tunggal:**
   - **Level Aktif:** Hanya membaca `tt_troubleticket.escalationlevelnumber` (`null` = belum eskalasi, `0..3` = Level 0 s/d Level 3).
   - **Riwayat Log:** Hanya membaca tabel `/c_incident/incidentticketmonitor/incwo_escalation_log` (`esc_level` berisi `"0"`, `"1"`, `"2"`, `"3"`, atau `"SUPPORT"`).
2. **Dihapus Sepenuhnya:**
   - Hapus fungsi `parseEscalationLevel` lama yang mem-parsing JSON string dari `escalationhistory` / `escalationlevel`.
   - Hapus fallback ke tabel lokal `incwo_incidentticketmonitor` / `inclink_linkdownticketmonitor` saat membaca detail TT.
   - Hapus fallback *regex scanning* pada `incident_chronology` untuk menebak level eskalasi.

### C. Aturan Sequential Step Button (`null` ➔ `0` ➔ `1` ➔ `2` ➔ `3`)
- Saat `currentLevel === null` (belum eskalasi) ➔ hanya tombol **`Level 0`** yang bisa diklik.
- Saat `currentLevel === 0` ➔ hanya bisa klik **`Level 0`** (tambah catatan di Level 0) atau naik ke **`Level 1`**.
- Saat `currentLevel === 1` ➔ hanya bisa klik **`Level 1`** atau naik ke **`Level 2`**.
- Saat `currentLevel === 2` ➔ hanya bisa klik **`Level 2`** atau naik ke **`Level 3`**.
- Saat `currentLevel === 3` ➔ sudah mencapai level maksimal (**`Level 3`**), hanya bisa tambah catatan di `Level 3`.

---

## 3. Daftar Lengkap 19 File yang Akan Diedit & Keterangannya

### Project 1: `Incident Ticket Monitor` (10 File)

| No | Path File | Baris | Keterangan Perubahan |
| :---: | :--- | :---: | :--- |
| 1 | `page/incidentticketmonitor.js` | `309–343`<br>`361–379`<br>`405–454`<br>`773–794`<br>`2226–2475`<br>`2913, 3450–3480` | • Ganti `parseEscalationLevel` menjadi `normalizeEscalationLevel(raw)` tanpa fallback JSON/history (`null` jika belum eskalasi, `0..3` jika aktif).<br>• Ubah `getEscalationBlinkMap` ke 4 level (`0: >30m`, `1: >90m`, `2: >170m`, `3: >230m`), hapus `>470m` (L5).<br>• Ubah `renderEscalationDotsHTML` dari 5 dot (`1..5`) menjadi **4 dot (`0, 1, 2, 3`)** dengan tooltip `Current: Level X/3`.<br>• Ubah `renderDetailModalDOM` & `updateEscalationModalUI` menjadi **4 tombol step** (`incwoStepBtn0` s/d `incwoStepBtn3` untuk `Level 0` s/d `Level 3`).<br>• Pada `setEscalationLevel` & `executeConfirmedEscalation`: ubah `if (!targetLevel)` menjadi `if (targetLevel === null || targetLevel === undefined)` agar angka `0` bisa disimpan, dan terapkan urutan `null ➔ 0 ➔ 1 ➔ 2 ➔ 3`.<br>• Pada `copyEscalationLogFormatted` & `exportEscalationLogsToExcel`: pastikan `esc_level = 0` tercetak `[Level 0]` / `Level 0`. |
| 2 | `page/incidentticketmonitorstyle.css` | `1414–1694` | • Ubah selector `.active-l1..l4`, `.blink-alert-l1..l4`, `.is-active-l1..l4` menjadi **`l0, l1, l2, l3`**.<br>• Hapus seluruh class `l5` (`active-l5`, `blink-alert-l5`, `is-active-l5`). |
| 3 | `escalationpopupprocesstt/escalation_panel.js` | `22–38`<br>`97–115`<br>`198–308`<br>`382–530`<br>`586–775`<br>`1185–1325`<br>`1580–1635` | • Ubah state awal `currentLevel: null` (sebelumnya `0`).<br>• Ubah `getEscalationBlinkMap` ke `0..3` (`30m, 90m, 170m, 230m`), hapus `>470m`.<br>• Pada `renderInlineControls` & `updateInlineUI`: render 4 dot (`0, 1, 2, 3`), badge teks `"No Escalation"` saat `null` dan `"Level 0..3"` saat aktif.<br>• Pada `renderMainModalDOM` & `updateMainModalUI`: render 4 tombol step (`pttEscStepBtn0` s/d `pttEscStepBtn3` untuk `Level 0` s/d `Level 3`).<br>• Pada `onClickStepLevel` & `executeConfirmedEscalation`: izinkan `targetLevel === 0`, validasi berurutan mulai dari `Level 0`, injeksi tag `[ESCALATION LEVEL 0..3]` ke chronology.<br>• Pada `loadTicketAndLogs`: **Zero-Fallback** — baca murni dari `tt_troubleticket.escalationlevelnumber`, hapus fallback `escalationhistory` dan regex chronology. |
| 4 | `escalationpopupprocesstt/escalation_panel.css` | `98–178`<br>`368–394` | • Ubah class dot dan step button dari `l1..l4` menjadi **`l0..l3`** dan hapus seluruh class `l5`. |
| 5 | `services/incwo_query_tt_info_get_list.js` | `120` | • Kembalikan `null` (bukan `0`) jika `tt_live_escalationlevelnumber` di database bernilai null/kosong, sehingga angka `0` murni menandakan **Level 0**. |
| 6 | `services/incwo_query_tt_detail.js` | `84–97`<br>`129–141` | • **Zero-Fallback**: ambil `escalationlevelnumber` langsung dari `tt_troubleticket` (`null` jika belum eskalasi, `0..3` jika sudah).<br>• Hapus pembacaan `escalationhistory` dan hapus fallback ke tabel lokal `incwo_incidentticketmonitor`. |
| 7 | `services/incwo_update_tt_info.js` | `18–27`<br>`40–69`<br>`90, 107–114` | • Ubah pengecekan yang sebelumnya `> 0` menjadi `!== null && >= 0` agar saat operator menaikkan tiket ke **`Level 0`**, nilai `0` benar-benar di-update ke `tt_troubleticket.escalationlevelnumber` dan `incwo_incidentticketmonitor.escalationlevelnumber`. |
| 8 | `services/incwo_get_escalation_log_text.js` | `92` | • Pastikan `item.esc_level === 0` atau `"0"` diformat menjadi `[Level 0]` tanpa fallback `item.level`. |
| 9 | `tt11 script/load_escalation_in_flow.js` | `133–142` | • Ubah pengecekan `if (!isNaN(levelNum) && levelNum > 0)` menjadi `levelNum !== null && levelNum >= 0 && levelNum <= 3` agar **`Level 0`** tampil sebagai `"Level 0"` pada form OWS TT11 (tidak salah tampil menjadi `"No Escalation"`). |
| 10 | `tt11 script/process_tt_overwrite_guard.js` | `691` | • Ubah pembacaan snapshot `escLevel` dari `Number(data.escalationlevelnumber || 0)` menjadi `null` jika kosong dan `Number(...)` jika terisi (`0..3`), sehingga perubahan dari `null` ke `Level 0` tetap terdeteksi oleh guard. |

---

### Project 2: `Link Down Ticket Monitor` (5 File)

| No | Path File | Baris | Keterangan Perubahan |
| :---: | :--- | :---: | :--- |
| 11 | `page/linkdownticketmonitor.js` | `303–337`<br>`355–373`<br>`399–448`<br>`764–785`<br>`2270–2520`<br>`2955, 3490–3520` | • Sama persis dengan `incidentticketmonitor.js`:<br>  - **Zero-Fallback** `normalizeEscalationLevel` (`null` vs `0..3`).<br>  - `getEscalationBlinkMap` untuk `0..3` (`30m, 90m, 170m, 230m`), hapus `>470m`.<br>  - Render **4 dot (`0, 1, 2, 3`)** di kartu & **4 tombol step (`inclinkStepBtn0..3` / `Level 0..3`)** di modal detail.<br>  - Izinkan simpan `targetLevel === 0` dan urutan `null ➔ 0 ➔ 1 ➔ 2 ➔ 3`.<br>  - Dukungan `Level 0` pada copy & export Excel log. |
| 12 | `page/linkdownticketmonitorstyle.css` | `1404–1684` | • Ubah class `.active-l1..l4`, `.blink-alert-l1..l4`, `.is-active-l1..l4` menjadi **`l0, l1, l2, l3`** dan hapus semua class `l5`. |
| 13 | `services/inclink_query_tt_info_get_list.js` | `117` | • Kembalikan `null` (bukan `0`) saat `tt_live_escalationlevelnumber` kosong. |
| 14 | `services/inclink_query_tt_detail.js` | `50–62`<br>`88–100` | • **Zero-Fallback**: baca `escalationlevelnumber` langsung dari `tt_troubleticket` (`null` vs `0..3`), hapus pembacaan `escalationhistory` dan fallback tabel lokal. |
| 15 | `services/inclink_update_tt_info.js` | `18–27`<br>`54–82`<br>`97, 113–120` | • Ubah pengecekan `> 0` agar nilai `0` (`Level 0`) bisa disimpan ke `tt_troubleticket` dan `inclink_linkdownticketmonitor`. |

---

### Project 3: `Escalation Report` (2 File)

| No | Path File | Baris | Keterangan Perubahan |
| :---: | :--- | :---: | :--- |
| 16 | `page/escalation_report.js` | `101–108`<br>`464–465`<br>`607, 987–988`<br>`1360–1460` | • Ubah opsi filter dropdown `<select id="escrepSelectLevel">` dari `Level 1..5` menjadi **`Level 0`, `Level 1`, `Level 2`, `Level 3`**.<br>• Ubah render kolom Level di tabel dan Export Excel dari `lvl > 0 ? lvl : "-"` menjadi pengecekan `lvl !== null && lvl >= 0` agar **`0` (`Level 0`) tampil sebagai `0`**, sedangkan `null` tampil sebagai `-`.<br>• Sesuaikan data mock preview ke rentang `0..3` dan `null`. |
| 17 | `services/td_escalationreport.js` | `174`<br>`309–372` | • **Zero-Fallback**: hapus pembacaan `t.escalationhistory || t.escalationlevel`.<br>• Gunakan `tt.escalationlevelnumber` (`0..3`) dan keberadaan log di `incwo_escalation_log` untuk filter `onlyEscalated` maupun penentuan `current_level`. |

---

### Project 4: `Incident Gate Milestones Dasahboard` (2 File)

| No | Path File | Baris | Keterangan Perubahan |
| :---: | :--- | :---: | :--- |
| 18 | `services/gate_summaryget.js` | `172–208` | • Tambahkan `tt.escalationlevelnumber as escalationlevelnumber` pada query `SELECT` dari `/TroubleTicket/TroubleTicket/tt_troubleticket`. |
| 19 | `page/gate_milestones_dashboard.js` | `1626–1638`<br>`1797, 1849` | • Pada tabel & export Excel **Prolong Incidents (> 4h)** kolom *Escalation Level Done*: langsung baca `row.escalationlevelnumber` (**Zero-Fallback**, tampilkan `Level 0` s/d `Level 3`, atau `-` jika `null`), menggantikan fungsi lama yang menebak pakai regex chronology `maxLevel > 0`. |

---

## 4. Checklist Eksekusi Besok

- [ ] **Step 1:** Update backend services & frontend `Incident Ticket Monitor` (10 file).
- [ ] **Step 2:** Update backend services & frontend `Link Down Ticket Monitor` (5 file).
- [ ] **Step 3:** Update backend service & frontend `Escalation Report` (2 file).
- [ ] **Step 4:** Update backend service & frontend `Incident Gate Milestones Dasahboard` (2 file).
- [ ] **Step 5:** Verifikasi visual CSS (memastikan tidak ada `@media` / `@keyframes` di file `.css` agar bebas error ADC Studio `10010003`) dan commit seluruh perubahan.

