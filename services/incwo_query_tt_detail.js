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
    var ttInfo = null;
    try {
        var localRes = ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get",
            request
        );
        if (!COMMON_UTIL.isNull(localRes) && !COMMON_UTIL.isNull(localRes.result)) {
            ttInfo = localRes.result;
        }
    } catch (eLoc) {
        console.error(PREFIX + "get local incwo error: " + eLoc.message);
    }

    if (COMMON_UTIL.isNull(ttInfo)) {
        ttInfo = { orderid: orderid };
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
                ttInfo.prolong_reason = COMMON_UTIL.isNull(liveResult.prolong_reason) ? "" : liveResult.prolong_reason;
                let rawEscHistory = !COMMON_UTIL.isNull(liveResult.escalationhistory)
                    ? liveResult.escalationhistory
                    : (!COMMON_UTIL.isNull(liveResult.escalationlevel) ? liveResult.escalationlevel : "");
                ttInfo.escalationhistory = rawEscHistory;
                ttInfo.escalationlevel = rawEscHistory;
                let liveLvl = COMMON_UTIL.isNull(liveResult.escalationlevelnumber) ? null : liveResult.escalationlevelnumber;
                // Jika tt_troubleticket live bernilai null/0, gunakan data yang sudah tersimpan di tabel lokal
                if (!COMMON_UTIL.isNull(liveLvl) && Number(liveLvl) > 0) {
                    ttInfo.escalationlevelnumber = Number(liveLvl);
                } else if (!COMMON_UTIL.isNull(ttInfo.escalationlevelnumber) && Number(ttInfo.escalationlevelnumber) > 0) {
                    ttInfo.escalationlevelnumber = Number(ttInfo.escalationlevelnumber);
                } else {
                    ttInfo.escalationlevelnumber = null;
                }
                ttInfo.escalationsupport = COMMON_UTIL.isNull(liveResult.escalationsupport) ? "NO_NEED" : liveResult.escalationsupport;
                let respId = COMMON_UTIL.isNull(liveResult.responsibility) ? "" : liveResult.responsibility;
                ttInfo.responsibility = respId;
                ttInfo.pic = getVendorName(respId);
                if (!COMMON_UTIL.isNull(liveResult.estimated_cp)) {
                    ttInfo.estimated_cp = liveResult.estimated_cp;
                }

                // Sertakan alarm_time dan aging_time yang konsisten dengan get_list
                let liveAlarm = liveResult.createfaultfirstoccurtime || ttInfo.alarm_time;
                if (!COMMON_UTIL.isNull(liveAlarm)) {
                    let zoneId = _runtime.timeZone;
                    ttInfo.alarm_time = TimeUtil.utc2Local(liveAlarm, zoneId);
                    let nowMs = new Date().getTime();
                    ttInfo.aging_time = getAgingTime(liveAlarm, nowMs);
                }
            }
        } catch (e) {
            console.error(PREFIX + "fetch live tt_troubleticket detail error: " + e);
        }
    }

    if (ttInfo.tt_domain != "FTTH") {
        ttInfo["estimated_cp"] = "-";
    }

    let vendorList = getVendorList();
    let currentUser = getUserDisplayName();
    let escalationLogs = getEscalationLogs(orderid);

    // Proteksi anti-reset & anti-null: sinkronkan dengan level tertinggi di riwayat incwo_escalation_log
    let maxLogLevel = 0;
    if (Array.isArray(escalationLogs) && escalationLogs.length > 0) {
        escalationLogs.forEach(function (row) {
            let lType = String(row.log_type || "").toUpperCase();
            let lNum = Number(row.esc_level || 0);
            if (lType.indexOf("ESCALATION") !== -1 && !isNaN(lNum) && lNum > maxLogLevel) {
                maxLogLevel = lNum;
            }
        });
    }

    let resolvedLvl = Number(ttInfo.escalationlevelnumber || 0);
    ttInfo.escalationlevelnumber = Math.max(resolvedLvl, maxLogLevel);

    return {
        data: ttInfo,
        vendorList: vendorList,
        current_user: currentUser,
        escalation_logs: escalationLogs
    };
}

function getUserDisplayName() {
    let accountId = (typeof _runtime !== "undefined" && _runtime && _runtime.userName) ? String(_runtime.userName).trim() : "";
    if (!accountId) {
        return "";
    }
    try {
        let uRes = ServiceInvoker.post("/adc-service/rest/v1/services/System/usermgt/um_user_get", {
            account_id: accountId
        });
        if (!COMMON_UTIL.isNull(uRes) && !COMMON_UTIL.isNull(uRes.result) && !COMMON_UTIL.isNull(uRes.result.fullname)) {
            return uRes.result.fullname;
        }
    } catch (eSrv) {
        console.error(PREFIX + "um_user_get failed: " + eSrv);
    }
    return accountId;
}

function getVendorList() {
    let tql = `select id, name, label from "/DataSource/msup_customization_options/customization_options_vendor" order by name asc`;
    let request = {
        start: 0,
        limit: 500,
        tql: tql,
        parameters: {},
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            return response.results;
        }
    } catch (e) {
        console.error(PREFIX + " getVendorList failed: " + e);
    }
    return [];
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

function getEscalationLogs(orderId) {
    if (COMMON_UTIL.isNull(orderId)) return [];
    let tql = `select id, orderid, log_type, esc_level, support_status, description, operator_id, operator_name, create_time ` +
        `from "/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_escalation_log" ` +
        `where orderid = $orderid ` +
        `order by create_time asc`;
    let request = {
        start: 0,
        limit: 100,
        tql: tql,
        parameters: { orderid: String(orderId).trim() },
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            return response.results;
        }
    } catch (e) {
        console.error(PREFIX + " getEscalationLogs failed: " + e);
    }
    return [];
}

function getAgingTime(alarmTime, timeUTC7) {
    let aging = "";
    if (COMMON_UTIL.isNull(alarmTime)) {
        return aging;
    }
    let alarmTimestamp = TimeUtil.parseTimestamp(
        alarmTime,
        "yyyy-MM-dd HH:mm:ss"
    );
    const diffMs = Math.abs(Number(timeUTC7) - Number(alarmTimestamp));
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours + " hours " + minutes + " minutes";
}
