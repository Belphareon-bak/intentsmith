// Chronological experiment: benchmark-v1 (2026-09-12). Frozen calibration used
// modelWeight=0, T=.85; locked holdout did not establish an improvement over the
// simple market baseline (paired week-bootstrap CI crossed zero). Keep baseline.
export const FORECAST_POLICY=Object.freeze({
  id:'football-1x2-policy-v1',selectedMethod:'market-proportional-v1',
  structuralSpec:Object.freeze({id:'dc-ridge-v1',halfLifeDays:365,ridge:0.005}),
  structuralRole:'diagnostic',calibrationStatus:'BASELINE_ONLY',
  benchmark:{id:'football-five-leagues-20260912-v1',validationFrom:'2021-07-01',validationTo:'2023-07-01',calibrationTo:'2024-07-01',testTo:'2026-07-01',commonTestMatches:3306,
    baselineLogLoss:0.9700896847355414,structuralLogLoss:0.9879195186689586,calibratedLogLoss:0.9698735669189,
    calibratedMinusBaselineCI95:Object.freeze([-0.0024920595037423118,0.0021158062872439825])},
});
