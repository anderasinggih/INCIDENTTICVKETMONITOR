# OWS Services Specification - Incident Ticket Monitor

Dokumen ini merangkum 6 backend script service baru yang telah disesuaikan secara khusus untuk modul **`IncidentTicketMonitor`** dengan entitas data model **`/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor`**.

---

## 1. Daftar Endpoint Service Baru

| No | Nama File Service Script | Rekomendasi Service ID OWS ADC Studio | Method | Deskripsi & Interaksi Data Model |
|---|---|---|---|---|
| 1 | [`incwo_create_tt_info.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_create_tt_info.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_create_tt_info` | POST | **Read-Only** dari `/TroubleTicket/TroubleTicket/tt_troubleticket`, lalu menyimpan data snapshot ke `incwo_incidentticketmonitor` via basic service `batch_upsert`. |
| 2 | [`incwo_query_tt_info_get_list.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_query_tt_info_get_list.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_tt_info_get_list` | POST | Mengambil daftar tiket aktif (`active = true`) dari `incwo_incidentticketmonitor`, di-`LEFT JOIN` ke `tt_troubleticket` (Read-Only) untuk mengambil status alarm terbaru (`ticketstatus`, `closetime`). |
| 3 | [`incwo_query_tt_detail.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_query_tt_detail.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_tt_detail` | POST | Mengambil 1 detail tiket dari `incwo_incidentticketmonitor` via basic service `incwo_incidentticketmonitor_get`. |
| 4 | [`incwo_update_tt_info.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_update_tt_info.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_update_tt_info` | POST | **Update tabel lokal** `incwo_incidentticketmonitor` (Root Cause, Sub Root Cause, RCA, PIC, Impact, Action, ETR, CP). **Sinkronisasi 2 field khusus** ke `tt_troubleticket`: `incident_chronology` dan `link_segment`. |
| 5 | [`incwo_tt_update_description.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_tt_update_description.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_tt_update_description` | POST | Sinkronisasi / update catatan `tt_action` ke model lokal `incwo_incidentticketmonitor`. |
| 6 | [`incwo_query_link_down_tt_list.js`](file:///Volumes/LVNPC/HUAWEI/PROJECT/Incident%20Ticket%20Monitor/services/incwo_query_link_down_tt_list.js) | `/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_link_down_tt_list` | POST | **100% Read-Only** query ke `tt_troubleticket` untuk rekomendasi daftar tiket Link Down MPLS & DWDM. |

---

## 2. Jaminan Keamanan Tiket Utama (`tt_troubleticket`)
- **Query List (`incwo_query_tt_info_get_list.js`)**: Hanya menjalankan `SELECT ... FROM incwo_incidentticketmonitor LEFT JOIN tt_troubleticket`. **Zero write/update**.
- **Create Ticket (`incwo_create_tt_info.js`)**: Hanya menjalankan `SELECT ... FROM tt_troubleticket WHERE orderid = $orderid`. **Zero write/update**.
- **Query Detail & Link Down**: Murni operasi `SELECT`.
- **Update Ticket (`incwo_update_tt_info.js`)**: Seluruh field editan (RCA, ETR, PIC, OTDR, dll.) tersimpan di `incwo_incidentticketmonitor`. Sesuai konfirmasi Anda, yang disinkronkan ke tiket utama **hanya 2 field**:
  ```javascript
  {
      orderid: orderId,
      incident_chronology: ttInfo.tt_action, // Log aksi
      link_segment: inter_station            // Segmen link
  }
  ```
