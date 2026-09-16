const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error: " + e);
    return { data: [], fwaNum: 0, ftthNum: 0 };
}

function main() {
    let now = new Date();
    let timeUTC7 = now.getTime();
    let results = getTTList();
    let zoneId = _runtime.timeZone;
    let fwaNum = 0;
    let ftthNum = 0;
    let pmaNum = 0;
    let list = [];

    for (let i = 0; i < results.length; i++) {
        let info = results[i];
        let orderId = info.orderid || "";
        let isPMA = orderId.startsWith("PMA-") || (info.tt_domain && String(info.tt_domain).toUpperCase() === "PMA");

        if (isPMA) {
            pmaNum++;

            let pmaTitle = !COMMON_UTIL.isNull(info.pma_live_title) ? info.pma_live_title : (info.title || "");
            let pmaPtSource = !COMMON_UTIL.isNull(info.pma_problem_ticket_id) ? info.pma_problem_ticket_id : (info.cm_orderid || "");
            let pmaPic = !COMMON_UTIL.isNull(info.pma_pt_responsibility_party) ? info.pma_pt_responsibility_party : (info.pic || "");
            let pmaPlanStart = !COMMON_UTIL.isNull(info.pma_plan_start_time) ? info.pma_plan_start_time : (info.alarm_time || "");
            let pmaPlanEnd = !COMMON_UTIL.isNull(info.pma_plan_end_time) ? info.pma_plan_end_time : (info.clear_time || "");
            let pmaRootCause = !COMMON_UTIL.isNull(info.pma_root_cause) ? info.pma_root_cause : (info.root_cause || "");
            let pmaSubRootCause = !COMMON_UTIL.isNull(info.pma_sub_root_cause) ? info.pma_sub_root_cause : (info.sub_root_cause || "");
            let pmaLinkSegment = !COMMON_UTIL.isNull(info.pma_link_segment_detail) ? info.pma_link_segment_detail : (info.inter_station || "");
            let pmaAction = !COMMON_UTIL.isNull(info.pma_resolution_notes) ? info.pma_resolution_notes : (info.tt_action || "");
            let pmaStatus = !COMMON_UTIL.isNull(info.pma_order_status) ? info.pma_order_status : (info.ticket_status || "running");

            list.push({
                id: orderId,
                ticket_type: "PMA",
                title: pmaTitle,
                cm_orderid: pmaPtSource, // PT Source
                pic: pmaPic,             // PIC Contractor
                plan_start_time: COMMON_UTIL.isNull(pmaPlanStart) ? "" : TimeUtil.utc2Local(pmaPlanStart, zoneId),
                plan_end_time: COMMON_UTIL.isNull(pmaPlanEnd) ? "" : TimeUtil.utc2Local(pmaPlanEnd, zoneId),
                alarm_time: COMMON_UTIL.isNull(pmaPlanStart) ? "" : TimeUtil.utc2Local(pmaPlanStart, zoneId),
                clear_time: COMMON_UTIL.isNull(pmaPlanEnd) ? "" : TimeUtil.utc2Local(pmaPlanEnd, zoneId),
                root_cause: pmaRootCause,
                sub_root_cause: pmaSubRootCause,
                inter_station: pmaLinkSegment, // Link Segment
                link_segment_detail: pmaLinkSegment,
                ticket_status: pmaStatus,
                aging_time: getAgingTime(pmaPlanStart, timeUTC7),
                tt_action: pmaAction,
                tt_domain: "PMA",
                rca_description: pmaAction,
                predictive_etr: "-",
                estimated_cp: "-",
                impactsitelist: ""
            });
        } else {
            let dom = COMMON_UTIL.isNull(info.tt_domain) ? "" : String(info.tt_domain).toUpperCase();
            if (dom.indexOf("FTTH") !== -1) {
                ftthNum++;
            } else {
                fwaNum++;
            }

            // Langsung ambil dari data utama tt_troubleticket (tanpa fallback ke tabel snapshot lokal)
            let liveTitle = COMMON_UTIL.isNull(info.tt_live_title) ? "" : info.tt_live_title;
            let liveAlarmTime = COMMON_UTIL.isNull(info.tt_live_alarm_time) ? "" : info.tt_live_alarm_time;
            let liveClearTime = COMMON_UTIL.isNull(info.tt_live_clear_time) ? "" : info.tt_live_clear_time;
            let liveRootCause = COMMON_UTIL.isNull(info.tt_live_root_cause) ? "" : info.tt_live_root_cause;
            let liveSubRootCause = COMMON_UTIL.isNull(info.tt_live_sub_root_cause) ? "" : info.tt_live_sub_root_cause;
            let liveImpactSiteList = COMMON_UTIL.isNull(info.tt_live_impactsitelist) ? "" : info.tt_live_impactsitelist;
            let liveAction = COMMON_UTIL.isNull(info.tt_live_action) ? "" : info.tt_live_action;
            let liveEstimatedCp = COMMON_UTIL.isNull(info.tt_live_estimated_cp) ? "" : info.tt_live_estimated_cp;
            let livePic = !COMMON_UTIL.isNull(info.vendor_name)
                ? info.vendor_name
                : (!COMMON_UTIL.isNull(info.vendor_label)
                    ? info.vendor_label
                    : (!COMMON_UTIL.isNull(info.tt_live_responsibility) ? info.tt_live_responsibility : ""));

            list.push({
                id: info.orderid,
                ticket_type: "INC",
                title: liveTitle,
                cm_orderid: info.cm_orderid,
                inter_station: info.inter_station,
                pic: livePic,
                ticket_status: info.ticketstatus,
                alarm_time: COMMON_UTIL.isNull(liveAlarmTime)
                    ? ""
                    : TimeUtil.utc2Local(liveAlarmTime, zoneId),
                clear_time: COMMON_UTIL.isNull(liveClearTime)
                    ? ""
                    : TimeUtil.utc2Local(liveClearTime, zoneId),
                root_cause: liveRootCause,
                sub_root_cause: liveSubRootCause,
                impactsitelist: liveImpactSiteList,
                rca_description: info.rca_description,
                predictive_etr: info.predictive_etr,
                estimated_cp: info.tt_domain != "FTTH" ? "-" : (liveEstimatedCp || "-"),
                alarm_status: COMMON_UTIL.isNull(liveClearTime)
                    ? "OPEN"
                    : "Related To The Clear Time",
                aging_time: getAgingTime(liveAlarmTime, timeUTC7),
                tt_action: liveAction,
                tt_domain: info.tt_domain,
            });
        }
    }

    return { data: list, fwaNum: fwaNum, ftthNum: ftthNum, pmaNum: pmaNum };
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

// Mengambil list dari tabel lokal incwo_incidentticketmonitor di-LEFT JOIN dengan tiket utama tt_troubleticket dan pma_problemmanagementactivity (READ-ONLY)
function getTTList() {
    let tql = `select distinct inc.orderid, inc.tt_domain, inc.title, inc.cm_orderid, inc.inter_station, inc.pic,
            inc.alarm_time, inc.clear_time, inc.root_cause, inc.sub_root_cause, inc.rca_description, inc.predictive_etr,
            inc.estimated_cp, inc.tt_action,
            tt.ticketstatus,
            tt.title as tt_live_title,
            tt.createfaultfirstoccurtime as tt_live_alarm_time,
            tt.closetime as tt_live_clear_time,
            tt.root_cause as tt_live_root_cause,
            tt.sub_root_cause as tt_live_sub_root_cause,
            tt.impactsitelist as tt_live_impactsitelist,
            tt.incident_chronology as tt_live_action,
            tt.estimated_cp as tt_live_estimated_cp,
            v.name as vendor_name,
            v.label as vendor_label,
            tt.responsibility as tt_live_responsibility,
            pma.order_status as pma_order_status,
            pma.title as pma_live_title,
            pma.problem_ticket_id as pma_problem_ticket_id,
            pma.pt_responsibility_party as pma_pt_responsibility_party,
            pma.plan_start_time as pma_plan_start_time,
            pma.plan_end_time as pma_plan_end_time,
            pma.root_cause as pma_root_cause,
            pma.sub_root_cause as pma_sub_root_cause,
            pma.link_segment_detail as pma_link_segment_detail,
            pma.resolution_notes as pma_resolution_notes
            from "/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor" as inc
            left join "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt on inc.orderid = tt.orderid
            left join "/DataSource/msup_customization_options/customization_options_vendor" as v on tt.responsibility = v.id
            left join "/ProblemManagementActivity/ProblemManagementActivity/pma_problemmanagementactivity" as pma on inc.orderid = pma.order_id
            where inc.active = true 
            order by inc.tt_domain, inc.create_time DESC
           `;
    let request = {
        start: 0,
        limit: 1000,
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
        console.error(PREFIX + " getTTList failed: " + e);
    }
    return [];
}
