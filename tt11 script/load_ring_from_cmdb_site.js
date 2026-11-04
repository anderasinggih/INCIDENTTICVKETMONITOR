/**
 * OWS Process TT (TT11) Form Script: Load Ring from CMDB Site into 'ringshow'
 * Directory: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/tt11 script/
 * File: load_ring_from_cmdb_site.js
 *
 * Alur Kerja (Zero Fallback):
 * 1. Ambil 'siteid' langsung dari komponen form Trouble Ticket: S('siteid').getValue()
 * 2. Lookup field 'ring' ke cmdb_site via service c_datahub/cmdb/cmdb_site_get dengan payload { id: siteid }
 * 3. Set hasil 'ring' langsung ke komponen S('ringshow')
 * 4. Listen event ValueChange pada 'siteid' agar otomatis update jika siteid berubah
 */

U.ready(function () {
    var SERVICE_CMDB_SITE_GET = "/adc-service/rest/v1/services/c_datahub/cmdb/cmdb_site_get";

    function getSiteId() {
        if (typeof S !== "function" || !S("siteid")) return "";
        var val = S("siteid").getValue();
        if (!val) return "";
        return typeof val === "object" ? (val.value || val.id || "") : String(val).trim();
    }

    function loadRing(siteId) {
        if (!siteId || typeof MessageProcessor === "undefined" || !MessageProcessor.process) return;

        MessageProcessor.process({
            serviceId: SERVICE_CMDB_SITE_GET,
            data: { id: siteId },
            success: function (res) {
                var row = (res && res.result) ? (Array.isArray(res.result) ? res.result[0] : res.result) : (res && res.data ? res.data : res);
                var ringVal = (row && row.ring) ? (typeof row.ring === "object" ? (row.ring.displayValue || row.ring.value || "") : row.ring) : "-";

                if (typeof S === "function" && S("ringshow")) {
                    S("ringshow").setValue(ringVal);
                    if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.dispatch) {
                        Spl.EventBus.dispatch("ringshow", "ValueChange", { value: ringVal });
                    }
                }
            },
            error: function (err) {
                console.error("[load_ring] Failed to query cmdb_site:", err);
                if (typeof S === "function" && S("ringshow")) {
                    S("ringshow").setValue("-");
                }
            }
        });
    }

    // 1. Initial Load saat form dibuka
    var currentSiteId = getSiteId();
    if (currentSiteId) {
        loadRing(currentSiteId);
    }

    // 2. Re-trigger saat nilai siteid diubah oleh user/proses
    if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.register) {
        Spl.EventBus.register("siteid", "ValueChange", function (eventData) {
            var newSiteId = (eventData && (eventData.value || eventData.id)) || getSiteId();
            if (newSiteId) {
                loadRing(newSiteId);
            }
        });
    }
});
