# Prompt Agent OWS: Create Data Model & Basic Services

Dokumen ini berisi template prompt siap pakai untuk diberikan ke Agent / Copilot OWS ADC Studio guna membuat entitas Data Model `incidentticketmonitor` beserta seluruh Basic Service CRUD-nya.

---

```markdown
Please create a new Data Model entity and its standard Basic Services in Huawei OWS ADC Studio with the following specifications:

### 1. Data Model Specification
- Entity / Model Name: incidentticketmonitor
- Display Name: Incident Ticket Monitor
- Description: Data model for storing and monitoring incident work order watchlist

#### Field Attributes Table:
| No | Field Name | Display Name | Data Type | Properties (Length / Precision) | Nullable | Primary Key | Unique |
|---|---|---|---|---|---|---|---|
| 1 | orderid | orderid | Text | Max Length: 100, Text Type: Short | NO | YES | YES |
| 2 | title | title | Text | Max Length: 1000, Text Type: Normal | YES | NO | NO |
| 3 | cm_orderid | cm_orderid | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 4 | inter_station | inter_station | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 5 | start_time | start_time | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 6 | impact_mpls | impact_mpls | Text | Max Length: 262144, Text Type: Long | YES | NO | NO |
| 7 | pic | pic | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 8 | tt_action | tt_action | Text | Max Length: 262144, Text Type: Long | YES | NO | NO |
| 9 | alarm_time | alarm_time | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 10 | clear_time | clear_time | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 11 | sub_root_cause | sub_root_cause | Text | Max Length: 1000, Text Type: Normal | YES | NO | NO |
| 12 | rca_description | rca_description | Text | Max Length: 1000, Text Type: Normal | YES | NO | NO |
| 13 | impact | impact | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 14 | predictive_etr | predictive_etr | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 15 | estimated_cp | estimated_cp | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 16 | root_cause | root_cause | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 17 | tt_domain | tt_domain | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 18 | ticket_status | ticket_status | Text | Max Length: 200, Text Type: Normal | YES | NO | NO |
| 19 | create_time | create_time | Date & Time | - | YES | NO | NO |
| 20 | active | active | Boolean | Default: true | YES | NO | NO |
| 21 | change_time | change_time | Timestamp | Precision: Millisecond | YES | NO | NO |

---

### 2. Auto-Generate Basic Services (CRUD)
Please auto-generate the standard basic services for entity `incidentticketmonitor`:
1. `incidentticketmonitor_get` (Get single record by orderid / ID)
2. `incidentticketmonitor_get_list` (Get paginated list of records)
3. `incidentticketmonitor_create` (Create single record)
4. `incidentticketmonitor_update` (Update single record)
5. `incidentticketmonitor_batch_upsert` (Batch upsert multiple records via _values array)
6. `incidentticketmonitor_batch_delete` (Batch delete records by IDs / orderids)

Please confirm once the entity and all basic services are created and published successfully.
```

---

## 3. Catatan Endpoint Hasil Generate OWS

Setelah Agent OWS mengeksekusi prompt di atas, endpoint service otomatis yang akan terbentuk:

| Service | Tipe | URL Endpoint Standar OWS | Kegunaan |
|---|---|---|---|
| `incidentticketmonitor_get` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_get` | Query 1 record berdasarkan `orderid` |
| `incidentticketmonitor_get_list` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_get_list` | Query list record (pagination & filter) |
| `incidentticketmonitor_create` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_create` | Insert 1 record baru |
| `incidentticketmonitor_update` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_update` | Update data 1 record |
| `incidentticketmonitor_batch_upsert` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_batch_upsert` | Upsert banyak record sekaligus via `_values: [...]` |
| `incidentticketmonitor_batch_delete` | Basic Service | `/adc-service/rest/v1/services/{Project}/{Module}/incidentticketmonitor_batch_delete` | Hapus record (biasanya kita pakai soft delete `active: 0` via update) |
