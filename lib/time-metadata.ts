/** Missing precision and reference dates are data, not an invitation to infer them. */
export function temporalMetadata(q:any){
 const precision=q.as_of?'second':q.market_date?'date':'unknown';
 return {...q,quote_quality:q.quality??null,market_timezone:marketTimezone(q),timestamp_timezone:q.as_of?.endsWith('Z')?'UTC':q.as_of?.match(/[+-]\d{2}:\d{2}$/)?.[0]??'UTC',report_timezone:'Asia/Shanghai',time_precision:precision,as_of_note:q.as_of_label||(q.as_of?'供应商报价或更新时间；不代表本次读取时间':q.market_date?'上游仅提供交易日期，未提供可核实的精确时刻':'上游未提供可核实时间'),previous_date_status:q.previous_date?'provided':'not_provided',previous_date_note:q.previous_date_note||(q.previous_date?'同源历史或上游明确提供的参考交易日期':'上游未提供参考值对应日期，不以自然日或异源历史推测')};
}
export function marketTimezone(q:any):string|null{
 if(q.id==='nikkei225')return 'Asia/Tokyo';
 if(q.id==='kospi')return 'Asia/Seoul';
 if(['vix','vxn','sp500','nasdaq','dow','sox','us2y','us10y','us30y'].includes(q.id))return 'America/New_York';
 if(q.symbol&&/^(sh|sz|bj)\d{6}$/.test(q.symbol))return 'Asia/Shanghai';
 return q.quote_kind==='continuous_front_month_futures'?q.market_timezone??q.source_timezone??null:null;
}
