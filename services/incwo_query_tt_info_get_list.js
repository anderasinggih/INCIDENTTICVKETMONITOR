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
    let list = [];

    for (let i = 0; i < results.length; i++) {
        let info = results[i];
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
        let liveAction = COMMON_UTIL.isNull(info.tt_live_action) ? "" : info.tt_live_action;
        let liveEstimatedCp = COMMON_UTIL.isNull(info.tt_live_estimated_cp) ? "" : info.tt_live_estimated_cp;
        let livePic = COMMON_UTIL.isNull(info.tt_live_pic) ? "" : info.tt_live_pic;

        list.push({
            id: info.orderid,
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

    return { data: list, fwaNum: fwaNum, ftthNum: ftthNum };
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

// Mengambil list dari tabel lokal incwo_incidentticketmonitor di-LEFT JOIN dengan tiket utama tt_troubleticket (READ-ONLY)
function getTTList() {
    let tql = `select distinct inc.orderid, inc.tt_domain, inc.title, inc.cm_orderid, inc.inter_station, inc.pic,
            inc.alarm_time, inc.root_cause, inc.sub_root_cause, inc.rca_description, inc.predictive_etr,
            inc.estimated_cp, inc.tt_action,
            tt.ticketstatus,
            tt.title as tt_live_title,
            tt.createfaultfirstoccurtime as tt_live_alarm_time,
            tt.closetime as tt_live_clear_time,
            tt.root_cause as tt_live_root_cause,
            tt.sub_root_cause as tt_live_sub_root_cause,
            tt.incident_chronology as tt_live_action,
            tt.estimated_cp as tt_live_estimated_cp,
            coalesce(v.name, v.label, tt.responsibility) as tt_live_pic
            from "/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor" as inc
            left join "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt on inc.orderid = tt.orderid
            left join "/DataSource/msup_customization_options/customization_options_vendor" as v on tt.responsibility = v.id
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
