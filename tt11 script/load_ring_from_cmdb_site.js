/**
 * OWS Process TT (TT11) Form Script: Load Ring from CMDB Site into 'ringshow'
 * Directory: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/tt11 script/
 * File: load_ring_from_cmdb_site.js
 */

U.ready(function () {
    var SERVICE_CMDB_SITE_GET = "/adc-service/rest/v1/services/c_datahub/cmdb/cmdb_site_get";

    function getSiteId() {
        if (typeof S !== "function") return "";
        var comp = S("siteid") || S("site_id");
        if (!comp || !comp.getValue) return "";
        var val = comp.getValue();
        if (!val) return "";
        if (typeof val === "object") {
            return (val.value || val.id || val.site_id || val.siteid || "").toString().trim();
        }
        return String(val).trim();
    }

    function setRingshow(val) {
        var strVal = (val !== undefined && val !== null && String(val).trim() !== "") ? String(val).trim() : "-";
        if (typeof S === "function" && S("ringshow")) {
            var c = S("ringshow");
            if (typeof c.setValue === "function") c.setValue(strVal);
            if (typeof c.setText === "function") c.setText(strVal);
            if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.dispatch) {
                Spl.EventBus.dispatch("ringshow", "ValueChange", { value: strVal });
            }
        }
    }

    function loadRing(siteId) {
        if (!siteId || typeof MessageProcessor === "undefined" || !MessageProcessor.process) return;

        // Kirim id dan site_id agar cocok dengan spesifikasi schema cmdb_site_get
        var payload = { id: siteId, site_id: siteId };

        MessageProcessor.process({
            serviceId: SERVICE_CMDB_SITE_GET,
            data: payload,
            success: function (res) {
                var row = (res && res.result) ? (Array.isArray(res.result) ? res.result[0] : res.result)
                        : (res && res.data ? (Array.isArray(res.data) ? res.data[0] : res.data) : res);

                if (!row) {
                    setRingshow("-");
                    return;
                }

                var rawRing = row.ring !== undefined ? row.ring : (row.ring_name || row.ringname || row.RING);
                var ringVal = (rawRing && typeof rawRing === "object")
                    ? (rawRing.displayValue || rawRing.value || rawRing.label || "")
                    : rawRing;

                setRingshow(ringVal);
            },
            error: function (err) {
                console.error("[load_ring] Failed to query cmdb_site:", err);
                setRingshow("-");
            }
        });
    }

    function init() {
        var siteId = getSiteId();
        if (siteId) {
            loadRing(siteId);
        }
    }

    // 1. Initial Load dengan micro-delay agar form selesai render
    init();
    setTimeout(init, 500);

    // 2. Re-trigger saat siteid berubah
    if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.register) {
        Spl.EventBus.register("siteid", "ValueChange", function (eventData) {
            var newId = (eventData && (eventData.value || eventData.id || eventData.site_id)) || getSiteId();
            if (newId) loadRing(newId);
        });
    }
});
