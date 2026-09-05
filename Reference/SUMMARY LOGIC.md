# Incident Ticket Monitor - Summary Logic & Technical Specifications

Dokumentasi ini merangkum seluruh logika bisnis, arsitektur data, alur servis, dan aturan tampilan untuk **Incident Ticket Monitor (Work Order Watchlist)** berdasarkan spesifikasi resmi dan aturan OWS.

---

## 1. Data Authenticity & General Rules (STRICT)
- **Official Data & Logic Only**: Tidak boleh menggunakan data dummy/mock, hardcode angka, atau mapping spekulatif.
- **No Arbitrary Fallbacks**: Saat loading atau data kosong, tampilkan state kosong (*No Work Orders*) atau notifikasi error yang jelas.
- **Zero External Library Dependency**: Murni Vanilla JavaScript & Vanilla CSS, tanpa ketergantungan framework runtime (Vue/ElementPlus opsional/di-decouple) agar aman dan ringan di ADC Studio.
- **Status Badge Styling**:
  - `running` -> **Warning / Yellow** (`.custom-status-running`)
  - `completed` / `complete` / `success` -> **Success / Green** (`.custom-status-complete`)
  - `cancel` / `canceled` / `failed` -> **Danger / Red** (`.custom-status-canceled`)
  - Status lainnya -> **Neutral / Slate** (`.custom-status-other`)
- **Domain Badge**:
  - `MPLS` -> Hijau Emerald (`#34d399` / `.custom-domain-badge.mpls`)
  - `DWDM` -> Merah Rose (`#f87171` / `.custom-domain-badge.dwdm`)

---

## 2. Arsitektur Komponen & Tampilan (Shadcn Dark Zinc)
Layout mengadopsi struktur kartu **Work Order Watchlist** dari standar Shadcn Dark Zinc (`#09090b` canvas, `#0d0d10` surface, border `#27272a`):

1. **Header Bar**:
   - Title: `Incident Ticket Monitor`
   - Subtitle / Live Clock: Tanggal & jam berjalan real-time.
   - Domain Metrics Badge:
     - FWA Count (`fwaNum`)
     - FTTH Count (`ftthNum`)
   - Last Updated Timestamp (`incwoLastUpdated`)
2. **Watchlist Toolbar**:
   - Judul section `Work Order Watchlist`
   - Counter tiket aktif (`incwoTicketWatchCount`)
   - Domain Filter Switcher (`ALL`, `FWA`, `FTTH`)
   - Tombol `+ Add Work Order` (disabled jika sudah mencapai `maxTickets = 12`)
3. **Work Order Cards Grid**:
   - Card disusun dalam grid responsif (`repeat(auto-fill, minmax(420px, 1fr))`).
   - Setiap card memiliki:
     - **Card Header**: Ticket ID (mono font), Domain Badge, Status Pill, Tombol `Details`, dan Tombol `✕ Delete`.
     - **Section Overview**: Title, CM Order ID, PIC Contractor.
     - **Section Timeline & Alarm**: Alarm Time, Clear Time, Aging Time, Alarm Status.
     - **Section Root Cause & Diagnostics**: Root Cause, Sub Root Cause, Predictive ETR, Fiber Doctor / OTDR.
     - **Section RCA Description**: Ringkasan akar masalah.
     - **Section Action Timeline**: Riwayat log tindakan teknis dengan visual milestone timeline (`.custom-timeline`).

---

## 3. Integrasi Service ADC / OWS (`MessageProcessor`)

Seluruh komunikasi backend menggunakan `MessageProcessor.process` dengan service endpoint resmi:

| No | Nama Service | Endpoint Service ID | Parameter Request | Deskripsi Logika & Alur |
|---|---|---|---|---|
| 1 | **Query Ticket List** | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_info_get_list` | `{ action: 'queryTicketList' }` | Mengambil seluruh tiket aktif (`res.data`), total MPLS (`res.mplsNum`), dan total DWDM (`res.dwdmNum`). Otomatis di-refresh tiap 3 menit. |
| 2 | **Query PIC List** | `/adc-service/rest/v1/services/datahub/cmdb/cmdb_contractor_getList` | `{ start: 0, limit: 100 }` | Mengambil master daftar kontraktor/PIC untuk pilihan dropdown di modal detail. |
| 3 | **Query Link Segment**| `/adc-service/rest/v1/services/c_TroubleTicket/TroubleTicket/tt_affected_link_segment_get_list` | `{ start: 0, limit: 1000, active: true, sort: 'segment_name', dir: 'ASC' }` | Mengambil master segmen link untuk pemilihan multiple InterStation di modal detail. |
| 4 | **Query Ticket Detail**| `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_detail` | `{ orderid: orderId }` | Mengambil detail lengkap tiket saat tombol *Details* diklik. Digabung secara paralel via `Promise.all` dengan PIC dan Segment List. |
| 5 | **Create Work Order** | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_create_tt_info` | `{ orderid: ticketId, domain: domain }` | Membuat/mendaftarkan tiket ke watchlist dashboard. Maksimal 12 tiket. |
| 6 | **Update Work Order** | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_update_tt_info` | `{ orderid: orderId, data: updatedData }` | Menyimpan perubahan data dari form modal detail (Root Cause, Sub Root Cause, RCA, ETR, Fiber Doctor/OTDR, PIC, InterStation, Impact, Action). |
| 7 | **Delete Work Order** | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_update` | `{ orderid: orderId, active: 0 }` | Melakukan soft delete tiket (`active: 0`) dari watchlist dashboard dengan modal konfirmasi. |

---

## 4. Modal & User Interactions
1. **Modal Add Work Order**:
   - Input: Domain (`MPLS` / `DWDM`), Ticket ID / TT number.
   - Validasi: Maksimum 12 tiket aktif.
2. **Modal Detail & Edit**:
   - Field editing:
     - `root_cause` & `sub_root_cause`
     - `rca_description`
     - `predictive_etr`
     - `estimated_cp` (Fiber Doctor / OTDR)
     - `pic` (Dropdown dari CMDB contractor)
     - `selectedSegments` / `inter_station` (Pencarian & toggle segmen link inter-station)
     - `impact_mpls` (Label dinamis: *DWDM Impact* atau *MPLS Impact*)
     - `tt_action` (Log tindakan teknis)
3. **Modal Delete Confirmation**:
   - Dialog konfirmasi aman dengan ikon peringatan dan penegasan ID tiket sebelum eksekusi delete.
4. **Toast Notification**:
   - Feedback visual instan untuk setiap respon sukses (hijau) atau gagal (merah) yang otomatis hilang dalam 3 detik.

---

## 5. Kepatuhan Standar OWS ADC Studio
- **Aturan Prefix CSS**: Seluruh class selector wajib diawali dengan `.custom-` (mencegah *Illegal CSS Error 10010006*).
- **Aturan CSS Clean**: Bebas dari komentar multi-line `/* */` yang tidak valid di parser tertentu, bebas `@keyframes` bermasalah, dan tanpa styling tag global (`body`, `html`).
- **Parsing OWS Aman**: Fungsi `extractOWSField` diterapkan pada seluruh nilai field untuk memastikan kompatibilitas format objek bersarang (`{ text, value, name }`), array, atau timestamp.
