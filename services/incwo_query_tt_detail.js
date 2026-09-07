const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error: " + e);
    return { data: {} };
}

function main() {
    let orderid = _message.orderid;
    var request = { orderid: orderid };

    // 1. Ambil data detail dari tabel lokal incwo_incidentticketmonitor
    var ttInfo = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get",
        request
    ).result;

    if (COMMON_UTIL.isNull(ttInfo)) {
        return { data: {} };
    }

    // 2. Ambil data live dari tiket utama tt_troubleticket jika ada perubahan dari OWS
    try {
        var ttLive = ServiceInvoker.post(
            "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get",
            request
        );
        if (!COMMON_UTIL.isNull(ttLive) && !COMMON_UTIL.isNull(ttLive.result)) {
            let liveResult = ttLive.result;
            if (!COMMON_UTIL.isNull(liveResult.incident_chronology)) {
                ttInfo.tt_action = liveResult.incident_chronology;
            }
            if (!COMMON_UTIL.isNull(liveResult.title)) {
                ttInfo.title = liveResult.title;
            }
            if (!COMMON_UTIL.isNull(liveResult.root_cause)) {
                ttInfo.root_cause = liveResult.root_cause;
            }
            if (!COMMON_UTIL.isNull(liveResult.sub_root_cause)) {
                ttInfo.sub_root_cause = liveResult.sub_root_cause;
            }
        }
    } catch (e) {
        console.error(PREFIX + "fetch live tt_troubleticket detail error: " + e);
    }

    if (ttInfo.tt_domain != "FTTH") {
        ttInfo["estimated_cp"] = "-";
    }

    return { data: ttInfo };
}
