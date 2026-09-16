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

    // 2. Ambil data live dari tiket utama (PMA vs INC) jika ada perubahan dari OWS
    let isPMA = orderid && orderid.startsWith("PMA-");
    if (isPMA) {
        try {
            let tql = `select order_id, order_status, title, problem_ticket_id, pt_responsibility_party,
                plan_start_time, plan_end_time, root_cause, sub_root_cause, link_segment_detail, resolution_notes,
                activity_summary, noc_activity_notes
                from "/ProblemManagementActivity/ProblemManagementActivity/pma_problemmanagementactivity"
                where order_id = $orderid`;
            let pmaRes = ServiceInvoker.post(
                "/adc-model/rest/v2/model-instances/query-by-tql",
                {
                    start: 0,
                    limit: 1,
                    tql: tql,
                    parameters: { orderid: String(orderid).trim() },
                    contains_total: false
                }
            );
            if (!COMMON_UTIL.isNull(pmaRes) && !COMMON_UTIL.isNull(pmaRes.results) && pmaRes.results.length > 0) {
                let livePma = pmaRes.results[0];
                ttInfo.tt_action = COMMON_UTIL.isNull(livePma.resolution_notes) ? "" : livePma.resolution_notes;
                ttInfo.title = COMMON_UTIL.isNull(livePma.title) ? "" : livePma.title;
                ttInfo.root_cause = COMMON_UTIL.isNull(livePma.root_cause) ? "" : livePma.root_cause;
                ttInfo.sub_root_cause = COMMON_UTIL.isNull(livePma.sub_root_cause) ? "" : livePma.sub_root_cause;
                ttInfo.inter_station = COMMON_UTIL.isNull(livePma.link_segment_detail) ? "" : livePma.link_segment_detail;
                ttInfo.link_segment_detail = ttInfo.inter_station;
                ttInfo.pic = COMMON_UTIL.isNull(livePma.pt_responsibility_party) ? "" : livePma.pt_responsibility_party;
                ttInfo.cm_orderid = COMMON_UTIL.isNull(livePma.problem_ticket_id) ? "" : livePma.problem_ticket_id;
                ttInfo.ticket_status = COMMON_UTIL.isNull(livePma.order_status) ? "" : livePma.order_status;
                ttInfo.activity_summary = COMMON_UTIL.isNull(livePma.activity_summary) ? "" : livePma.activity_summary;
                ttInfo.noc_activity_notes = COMMON_UTIL.isNull(livePma.noc_activity_notes) ? "" : livePma.noc_activity_notes;
            }
        } catch (e) {
            console.error(PREFIX + "fetch live pma detail error: " + e);
        }
    } else {
        try {
            var ttLive = ServiceInvoker.post(
                "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get",
                request
            );
            if (!COMMON_UTIL.isNull(ttLive) && !COMMON_UTIL.isNull(ttLive.result)) {
                let liveResult = ttLive.result;
                ttInfo.tt_action = COMMON_UTIL.isNull(liveResult.incident_chronology) ? "" : liveResult.incident_chronology;
                ttInfo.title = COMMON_UTIL.isNull(liveResult.title) ? "" : liveResult.title;
                ttInfo.root_cause = COMMON_UTIL.isNull(liveResult.root_cause) ? "" : liveResult.root_cause;
                ttInfo.sub_root_cause = COMMON_UTIL.isNull(liveResult.sub_root_cause) ? "" : liveResult.sub_root_cause;
                ttInfo.impactsitelist = COMMON_UTIL.isNull(liveResult.impactsitelist) ? "" : liveResult.impactsitelist;
                let respId = COMMON_UTIL.isNull(liveResult.responsibility) ? "" : liveResult.responsibility;
                ttInfo.pic = getVendorName(respId);
                if (!COMMON_UTIL.isNull(liveResult.estimated_cp)) {
                    ttInfo.estimated_cp = liveResult.estimated_cp;
                }
            }
        } catch (e) {
            console.error(PREFIX + "fetch live tt_troubleticket detail error: " + e);
        }
    }

    if (ttInfo.tt_domain != "FTTH") {
        ttInfo["estimated_cp"] = "-";
    }

    return { data: ttInfo };
}

function getVendorName(vendorId) {
    if (COMMON_UTIL.isNull(vendorId)) {
        return "";
    }
    let tql = `select name, label from "/DataSource/msup_customization_options/customization_options_vendor" where id = $id`;
    let request = {
        start: 0,
        limit: 1,
        tql: tql,
        parameters: { id: vendorId },
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results) && response.results.length > 0) {
            let row = response.results[0];
            return row.name || row.label || vendorId;
        }
    } catch (e) {
        console.error(PREFIX + " getVendorName failed: " + e);
    }
    return vendorId;
}
