# ADC Service & Data Model Reference

Dokumentasi ini merinci seluruh **ADC REST Service Endpoint**, **Data Model**, dan **Field Mapping** yang digunakan pada modul Critical Ticket Monitor (CTM).

---

## 1. ADC REST Services (Endpoints)

| No | Service ID | Method / Function JS | Payload / Parameters | Keterangan & Tujuan |
|---|---|---|---|---|
| 1 | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_info_get_list` | `queryTicketListService()` | `{ action: 'queryTicketList' }` | Mengambil daftar tiket aktif/running (grid cards) serta total count per domain (`mplsNum`, `dwdmNum`). |
| 2 | `/adc-service/rest/v1/services/datahub/cmdb/cmdb_contractor_getList` | `queryPicListService()` | `{ start: 0, limit: 100 }` | Mengambil daftar contractor / PIC untuk opsi dropdown form detail. |
| 3 | `/adc-service/rest/v1/services/c_TroubleTicket/TroubleTicket/tt_affected_link_segment_get_list` | `queryLinkSegmentListService()` | `{ start: 0, limit: 1000, active: true, sort: "segment_name", dir: "ASC" }` | Mengambil master daftar segmen link / InterStation untuk multi-select form detail. |
| 4 | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_query_tt_detail` | `queryTicketDetailService(orderId)` | `{ orderid: orderId }` | Mengambil data detail lengkap suatu tiket untuk ditampilkan di modal edit/detail. |
| 5 | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_create_tt_info` | `createTicketService(data)` | `{ orderid: data.ticketId, domain: data.domain }` | Menambahkan tiket/work order baru ke dalam monitor. |
| 6 | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_update_tt_info` | `updateTicketService(orderId, data)` | `{ orderid: orderId, data: data }` | Menyimpan perubahan informasi detail work order dari form modal. |
| 7 | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_update` | `deleteTicketService(orderId)` | `{ orderid: orderId, active: 0 }` | Melakukan soft delete / nonaktifkan tiket dari tampilan dashboard (`active: 0`). |

---

## 2. Data Model & Entities

### A. TroubleTicket Model
- **Model Path**: `/TroubleTicket/TroubleTicket/tt_troubleticket`
- Merupakan entitas utama tabel tiket gangguan/work order.

### B. Link Segment Model
- **Model Path**: `/c_TroubleTicket/TroubleTicket/tt_affected_link_segment`
- **Fields**:
  - `segment_name`: Nama segmen link / inter-station

### C. CMDB Contractor Model (PIC)
- **Model Path**: `/datahub/cmdb/cmdb_contractor`
- **Fields**:
  - `contractor_name`: Nama kontraktor / PIC

---

## 3. Field Mapping & Struktur Data

### Summary Metrics
- `mplsNum`: Total tiket aktif dengan domain MPLS
- `dwdmNum`: Total tiket aktif dengan domain DWDM

### Ticket Card Item (`tickets[]`)
Field yang dirender pada masing-masing card:
- `id`: TT Number / Order ID
- `tt_domain`: Domain jaringan (`MPLS` / `DWDM`)
- `ticket_status`: Status tiket (misal: `running`)
- `title`: Judul tiket
- `cm_orderid`: ID order Change Management
- `inter_station`: InterStation / link segment lokasi terdampak
- `alarm_time`: Waktu alarm aktif
- `clear_time`: Waktu alarm clear
- `aging_time`: Durasi / aging tiket
- `rca_description`: Ringkasan Root Cause Analysis
- `pic`: PIC / Kontraktor penanggung jawab
- `alarm_status`: Status alarm
- `impact_mpls`: Keterangan dampak (MPLS / DWDM Impact)
- `tt_action`: Log / riwayat tindakan penanganan

### Ticket Detail Form (`detailForm`)
Field yang digunakan di modal detail/edit:
- `orderid`: Nomor tiket / TT ID
- `root_cause`: Akar permasalahan
- `sub_root_cause`: Sub-penyebab
- `rca_description`: Deskripsi lengkap RCA
- `predictive_etr`: Estimasi waktu perbaikan (Estimated Time to Repair)
- `estimated_cp`: Nilai / hasil Fiber Doctor / OTDR
- `pic`: Kontraktor / PIC yang dipilih
- `selectedSegments`: Array daftar segmen InterStation yang dipilih
- `impact_mpls`: Keterangan detail dampak
- `tt_action`: Log update aksi / tindakan teknis
