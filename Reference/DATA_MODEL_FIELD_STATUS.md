# Field Mapping & Audit: incwo_incidentticketmonitor

Dokumen ini merangkum audit field pada Data Model lokal:
`/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor`

Sejak dashboard dikonfigurasi untuk **membaca langsung (live fetch)** secara real-time dari entitas utama OWS (`/TroubleTicket/TroubleTicket/tt_troubleticket`), tabel lokal `incwo_incidentticketmonitor` sekarang bertindak sebagai **Watchlist Metadata & Custom Attribute Store**.

---

## 1. Ringkasan Status Field

| No | Nama Field di Model Lokal | Status | Sumber Data Saat Ini | Alasan / Keterangan |
|---|---|:---:|---|---|
| 1 | `orderid` | **AKTIF** | `incwo_incidentticketmonitor` | **Primary Identifier / Join Key** ke tiket utama. |
| 2 | `active` | **AKTIF** | `incwo_incidentticketmonitor` | Flag aktif/tidaknya tiket di watchlist (`true` = tampil, `false` = dihapus). |
| 3 | `tt_domain` | **AKTIF** | `incwo_incidentticketmonitor` | Kategori domain tab dashboard (`FWA` / `FTTH`). |
| 4 | `create_time` | **AKTIF** | `incwo_incidentticketmonitor` | Waktu tiket ditambahkan ke monitor (dasar sorting kartu). |
| 5 | `pic` | **TIDAK TERPAKAI** | `tt_troubleticket.responsibility` | Digantikan live fetch dari field `responsibility` di tiket utama OWS (read-only di popup). |
| 6 | `cm_orderid` | **AKTIF** | `incwo_incidentticketmonitor` | Nomor Change Management hasil parsing saat create. |
| 7 | `inter_station` | **AKTIF** | `incwo_incidentticketmonitor` | Keterangan segmen link / lokasi inter-station terdampak. |
| 8 | `rca_description` | **AKTIF** | `incwo_incidentticketmonitor` | Ringkasan narasi analisis akar masalah. |
| 9 | `predictive_etr` | **AKTIF** | `incwo_incidentticketmonitor` | Target estimasi waktu perbaikan (Estimated Time to Repair). |
| 10 | `title` | **TIDAK TERPAKAI** | `tt_troubleticket.title` | Digantikan live fetch dari tiket utama OWS. |
| 11 | `alarm_time` | **TIDAK TERPAKAI** | `tt_troubleticket.createfaultfirstoccurtime` | Digantikan live fetch dari waktu alarm pertama di OWS. |
| 12 | `clear_time` | **TIDAK TERPAKAI** | `tt_troubleticket.closetime` | Digantikan live fetch dari waktu close tiket OWS. |
| 13 | `root_cause` | **TIDAK TERPAKAI** | `tt_troubleticket.root_cause` | Digantikan live fetch dari root cause utama OWS. |
| 14 | `sub_root_cause` | **TIDAK TERPAKAI** | `tt_troubleticket.sub_root_cause` | Digantikan live fetch dari sub root cause OWS. |
| 15 | `tt_action` | **TIDAK TERPAKAI** | `tt_troubleticket.incident_chronology` | Digantikan live fetch dari catatan kronologi OWS. |
| 16 | `ticket_status` | **TIDAK TERPAKAI** | `tt_troubleticket.ticketstatus` | Digantikan live status tiket OWS (`running`, `completed`, dll.). |
| 17 | `estimated_cp` | **TIDAK TERPAKAI** | `tt_troubleticket.estimated_cp` | Digantikan live fetch dari hasil diagnosa kabel OWS. |
| 18 | `start_time` | **TIDAK TERPAKAI** | - | Disimpan saat create tapi tidak pernah dibaca/dirender di dashboard. |
| 19 | `impact_mpls` | **TIDAK TERPAKAI** | - | Kolom peninggalan modul CTM/DWDM, selalu bernilai kosong di modul ini. |

---

## 2. Rincian Field yang MASIH DIGUNAKAN (Wajib Ada)

Field-field ini **tidak boleh dihapus** dari Data Model lokal karena menyimpan state watchlist dan data custom yang tidak didukung secara native oleh tabel OWS:

### 1. `orderid` (String)
* **Peran**: Kunci relasi (Foreign Key) ke `tt_troubleticket.orderid`.
* **Digunakan di**:
  - `incwo_query_tt_info_get_list.js` (Klausul `JOIN`)
  - `incwo_query_tt_detail.js` (Parameter get detail)
  - `incwo_update_tt_info.js` (Target update)
  - `incidentticketmonitor.js` (ID identitas kartu & modal)

### 2. `active` (Boolean)
* **Peran**: Soft delete mechanism.
* **Digunakan di**:
  - `incwo_query_tt_info_get_list.js` (`where inc.active = true`)
  - `incidentticketmonitor.js` (Saat user klik tombol *Delete Work Order*)

### 3. `tt_domain` (String)
* **Peran**: Menyaring tab (`ALL`, `FWA`, `FTTH`) dan counter metrik di header dashboard.
* **Digunakan di**:
  - `incwo_query_tt_info_get_list.js` (Perhitungan `fwaNum` & `ftthNum`)
  - `incidentticketmonitor.js` (Badge domain kartu dan tombol filter)

### 4. `create_time` (String / Timestamp)
* **Peran**: Menentukan urutan tampil kartu watchlist.
* **Digunakan di**:
  - `incwo_query_tt_info_get_list.js` (`order by inc.tt_domain, inc.create_time DESC`)

### 5. `pic` (String)
* **Peran**: Menyimpan nama kontraktor / vendor penanggung jawab tiket yang dipilih dispatcher dari dropdown form detail.
* **Alasan tetap di lokal**: OWS tidak menyediakan field PIC Contractor pada entitas `tt_troubleticket`.

### 6. `cm_orderid` (String)
* **Peran**: Menyimpan nomor Change Management hasil parsing `associateorderid` saat tiket pertama kali dimasukkan ke monitor.

### 7. `inter_station` (String)
* **Peran**: Menyimpan daftar segmen inter-station terdampak yang dipilih via modal detail.

### 8. `rca_description` (Text)
* **Peran**: Menyimpan narasi/keterangan diagnosa tambahan yang diinput tim operasi.

### 9. `predictive_etr` (String / Datetime)
* **Peran**: Menyimpan target waktu estimasi pemulihan jaringan (Estimated Time to Repair).

---

## 3. Rincian Field yang SUDAH TIDAK DIGUNAKAN (Redundant)

Field-field ini awalnya dirancang untuk snapshot offline, namun sekarang **sepenuhnya diabaikan** saat query list maupun modal detail:

1. **`title`**: Langsung membaca live dari `tt_troubleticket.title`.
2. **`alarm_time`**: Langsung membaca live dari `tt_troubleticket.createfaultfirstoccurtime`.
3. **`clear_time`**: Langsung membaca live dari `tt_troubleticket.closetime`.
4. **`root_cause`**: Langsung membaca live dari `tt_troubleticket.root_cause`.
5. **`sub_root_cause`**: Langsung membaca live dari `tt_troubleticket.sub_root_cause`.
6. **`tt_action`**: Langsung membaca live dari `tt_troubleticket.incident_chronology`.
7. **`ticket_status`**: Langsung membaca live dari `tt_troubleticket.ticketstatus`.
8. **`estimated_cp`**: Langsung membaca live dari `tt_troubleticket.estimated_cp`.
9. **`start_time`**: Nilai duplikat `createtime` yang tidak ditampilkan di UI mana pun.
10. **`impact_mpls`**: Atribut spesifik DWDM/CTM yang tidak relevan untuk Incident Ticket Monitor.

---

## 4. Rekomendasi Pemeliharaan Data Model

* **Jika ingin membersihkan Data Model**: Anda aman untuk menghapus/menonaktifkan ke-10 field yang berstatus **TIDAK TERPAKAI** di atas dari skema tabel `incwo_incidentticketmonitor` di ADC Studio.
* **Tidak Merusak UI**: UI Dashboard tidak akan terpengaruh sama sekali karena service `incwo_query_tt_info_get_list.js` dan `incwo_query_tt_detail.js` sudah diarahkan langsung ke tabel utama `tt_troubleticket`.
