const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error" + e);
}

function main() {
    let now = new Date();
    let timeUTC7 = now.getTime();
    let results = getTTList();
    let zoneId = _runtime.timeZone;
    let mplsNum = 0;
    let dwdmNum = 0;
    let list = [];
    for (let i = 0; i < results.length; i++) {
        let info = results[i];

        if ((info.tt_domain == "MPLS")) {
            mplsNum++;
        } else {
            dwdmNum++;
        }
        list.push({
            id: info.orderid,
            title: info.title,
            cm_orderid: info.cm_orderid,
            inter_station: info.inter_station,
            impact_mpls: info.impact_mpls,
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
            impact: info.impact,
            rca_description: info.rca_description,
            predictive_etr: info.predictive_etr,
            estimated_cp: info.tt_domain != "DWDM" ? "-" : info.estimated_cp,
            alarm_status: COMMON_UTIL.isNull(info.clear_time)
                ? "OPEN "
                : "Realate To The Clear Time",
            aging_time: getAgingTime(info.alarm_time, timeUTC7),
            tt_action: info.tt_action,
            tt_domain: info.tt_domain,
        });
    }

    return { data: list, mplsNum: mplsNum, dwdmNum: dwdmNum };
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
    // 计算小时和剩余分钟
    // 总分钟数
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours + " hours " + minutes + " minutes";
}

function getTTList() {
    let tql = `select distinct td.orderid,tt_domain,td.title,cm_orderid,inter_station,impact_mpls,pic,
            td.alarm_time,td.root_cause,td.sub_root_cause,td.rca_description,td.predictive_etr,
            td.estimated_cp,tt.ticketstatus,tt_action,tt.closetime as clear_time
            from "/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket" as td
            left join '/TroubleTicket/TroubleTicket/tt_troubleticket' as tt on td.orderid=tt.orderid
            where td.active =true 
            order by tt_domain,create_time DESC
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
        console.error(PREFIX + " getTTEmsAlarmNo failed. " + e);
    }
    return [];
}
