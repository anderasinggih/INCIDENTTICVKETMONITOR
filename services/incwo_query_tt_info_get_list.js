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

        list.push({
            id: info.orderid,
            title: info.title,
            cm_orderid: info.cm_orderid,
            inter_station: info.inter_station,
            pic: info.pic,
            ticket_status: info.ticketstatus,
            alarm_time: COMMON_UTIL.isNull(info.alarm_time)
                ? ""
                : TimeUtil.utc2Local(info.alarm_time, zoneId),
            clear_time: COMMON_UTIL.isNull(info.clear_time)
                ? ""
                : TimeUtil.utc2Local(info.clear_time, zoneId),
            root_cause: info.root_cause,
            sub_root_cause: info.sub_root_cause,
            rca_description: info.rca_description,
            predictive_etr: info.predictive_etr,
            estimated_cp: info.tt_domain != "FTTH" ? "-" : info.estimated_cp,
            alarm_status: COMMON_UTIL.isNull(info.clear_time)
                ? "OPEN"
                : "Related To The Clear Time",
            aging_time: getAgingTime(info.alarm_time, timeUTC7),
            tt_action: info.tt_action,
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
            inc.estimated_cp, tt.ticketstatus, inc.tt_action, tt.closetime as clear_time
            from "/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor" as inc
            left join "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt on inc.orderid = tt.orderid
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
