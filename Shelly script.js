// ========= KRYPGRUNDSFLÄKT MED BTHOME (ABSOLUT FUKTIGHET + TEMPVILLKOR) =========
// Starta ENDAST om ute-luft är BÅDE torrare (lägre AF) OCH svalare (lägre T) än inne.
// Stoppa när något av villkoren inte längre uppfylls.
// Övrigt: BTHome, ålder/RSSI-logg, extra startmarginal vid ute-nöd-läge,
// 30 min min on/off + logg när blockering släpper.
// Senast uppdaterad: 2025-08-10

// --------------------- KONFIG ---------------------
// BTHomeSensor ID (från din enhet)
let OUT_BATT_ID = 200;
let OUT_RH_ID   = 201;  // % RF
let OUT_TEMP_ID = 202;  // °C

let IN_RH_ID    = 204;  // % RF (krypgrund)
let IN_TEMP_ID  = 205;  // °C (krypgrund)

// BTHomeDevice ID (för RSSI/logg)
let OUT_DEVICE_ID = 200;
let IN_DEVICE_ID  = 201;

// Styrparametrar
let FAN_ON_HYSTERESIS    = 1.0;   // g/m³ – min diff (AF_in - AF_out) för START
let EXTRA_HYST_EMERG_OUT = 1.0;   // g/m³ – extra marginal om UTE är i nöd-läge
let MIN_OUTDOOR_TEMP     = 2.0;   // °C – kör ej fläkt om ute under denna temp (frysskydd)
let MIN_INDOOR_RH_TARGET = 60.0;  // %  – stäng av om RF inne under denna gräns (torrt)

// Nöd-lägen (om data saknas/för gammal)
let EMERGENCY_MODE_TEMP_IN   = 15.0; // °C
let EMERGENCY_MODE_RH_IN     = 85.0; // %
let EMERGENCY_MODE_TEMP_OUT  = 10.0; // °C
let EMERGENCY_MODE_RH_OUT    = 80.0; // %

// Åldersgränser & intervall
let UPDATE_INTERVAL_S  = 300;    // var 5:e minut
let MAX_AGE_INDOOR_S   = 3600;   // 0 = ignorera ålder
let MAX_AGE_OUTDOOR_S  = 3600;   // 0 = ignorera ålder

// Anti-chatter (minsta tider) – 30 min
let MIN_ON_TIME_S  = 1800;  // minst 30 min på innan tillåten avstängning
let MIN_OFF_TIME_S = 1800;  // minst 30 min av innan tillåten start

// Relä som styr fläkten
let SWITCH_ID = 0;
// --------------------- SLUT KONFIG ---------------------

function nowSec(){ return Math.floor(Date.now()/1000); }

// Växlings-state (persistens över omstart finns inte)
let lastSwitchState = null;
let lastSwitchChangeTs = nowSec();

// För loggning av block-status (så vi kan skriva när blockeringen släpper)
let wasOnBlocked  = false; // “kunde inte stänga av pga MIN_ON_TIME”
let wasOffBlocked = false; // “kunde inte starta pga MIN_OFF_TIME”

function readSensor(id, cb){
  Shelly.call("BTHomeSensor.GetStatus", { id:id }, function(res, err){
    if (err || !res || res.value === undefined){
      cb({ ok:false, id:id, err: err ? JSON.stringify(err) : "no_value" });
      return;
    }
    let ts = null;
    if (res.last_updated_ts !== undefined) ts = res.last_updated_ts;
    else if (res.last_update_ts !== undefined) ts = res.last_update_ts;

    cb({
      ok:true,
      id:id,
      value: res.value,
      unit: res.unit || null,
      ts: ts
    });
  });
}

function readDevice(devId, cb){
  Shelly.call("BTHomeDevice.GetStatus", { id:devId }, function(res, err){
    if (err || !res){
      cb({ ok:false, err: err ? JSON.stringify(err) : "no_resp" });
      return;
    }
    cb({
      ok:true,
      rssi: (res.rssi !== undefined ? res.rssi : null),
      ts: (res.last_updated_ts !== undefined ? res.last_updated_ts : null),
      raw: res
    });
  });
}

function isTooOld(ts, maxAge){
  if (!ts || maxAge <= 0) return false;
  return (nowSec() - ts) > maxAge;
}

// Absolut fuktighet g/m³
function absHumidity(tC, rh){
  if (tC === undefined || rh === undefined || rh < 0 || rh > 100) return 0;
  let es = 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
  return (216.7 * (rh/100) * es) / (tC + 273.15);
}

function formatAge(ts){
  if (!ts) return "ålder okänd";
  return (nowSec() - ts) + "s gammal";
}

function ensureSwitchStateInit(cb){
  if (lastSwitchState !== null) { cb(); return; }
  Shelly.call("Switch.GetStatus", { id: SWITCH_ID }, function (st) {
    lastSwitchState = !!(st && st.output);
    lastSwitchChangeTs = nowSec();
    cb();
  });
}

function controlFanLogic(){
  try{
    ensureSwitchStateInit(function(){

      console.log("\n--- BTHome-styrning (AF+T villkor, 30 min min-tider, extra marginal, ålder/RSSI) ---");

      readSensor(OUT_TEMP_ID, function(OUT_T){
        readSensor(OUT_RH_ID, function(OUT_RH){
          readSensor(IN_TEMP_ID, function(IN_T){
            readSensor(IN_RH_ID, function(IN_RH){
              readDevice(OUT_DEVICE_ID, function(OUT_DEV){
                readDevice(IN_DEVICE_ID, function(IN_DEV){

                  // --- INNE ---
                  let indoorOld = !(IN_T.ok && IN_RH.ok) ||
                    isTooOld(IN_T.ts, MAX_AGE_INDOOR_S) || isTooOld(IN_RH.ts, MAX_AGE_INDOOR_S);

                  let isIndoorEmergency = indoorOld;
                  let T_in  = isIndoorEmergency ? EMERGENCY_MODE_TEMP_IN : IN_T.value;
                  let RH_in = isIndoorEmergency ? EMERGENCY_MODE_RH_IN   : IN_RH.value;

                  // --- UTE ---
                  let outdoorOld = !(OUT_T.ok && OUT_RH.ok) ||
                    isTooOld(OUT_T.ts, MAX_AGE_OUTDOOR_S) || isTooOld(OUT_RH.ts, MAX_AGE_OUTDOOR_S);

                  let isOutdoorEmergency = outdoorOld;
                  let T_out  = isOutdoorEmergency ? EMERGENCY_MODE_TEMP_OUT : OUT_T.value;
                  let RH_out = isOutdoorEmergency ? EMERGENCY_MODE_RH_OUT   : OUT_RH.value;

                  if (T_in === undefined || RH_in === undefined || T_out === undefined || RH_out === undefined){
                    console.log("Fel: Ofullständig data även efter nöd-läge. Avbryter cykel.");
                    return;
                  }

                  // --- AF & logg ---
                  let AF_in  = absHumidity(T_in, RH_in);
                  let AF_out = absHumidity(T_out, RH_out);

                  let ageInT  = IN_T.ok  ? formatAge(IN_T.ts)  : "okänt";
                  let ageInRH = IN_RH.ok ? formatAge(IN_RH.ts) : "okänt";
                  let ageOutT  = OUT_T.ok  ? formatAge(OUT_T.ts)  : "okänt";
                  let ageOutRH = OUT_RH.ok ? formatAge(OUT_RH.ts) : "okänt";

                  let rssiOut = (OUT_DEV.ok && OUT_DEV.rssi !== null) ? (OUT_DEV.rssi + " dBm") : "okänt";
                  let rssiIn  = (IN_DEV.ok  && IN_DEV.rssi  !== null) ? (IN_DEV.rssi  + " dBm") : "okänt";

                  console.log("INNE " + (isIndoorEmergency ? "(NÖD)" : "     ") +
                    ": " + T_in.toFixed(1) + "°C (" + ageInT + "), " +
                    RH_in.toFixed(1) + "% RF (" + ageInRH + "), AF " + AF_in.toFixed(2) + " g/m³, RSSI " + rssiIn);

                  console.log("UTE  " + (isOutdoorEmergency ? "(NÖD)" : "     ") +
                    ": " + T_out.toFixed(1) + "°C (" + ageOutT + "), " +
                    RH_out.toFixed(1) + "% RF (" + ageOutRH + "), AF " + AF_out.toFixed(2) + " g/m³, RSSI " + rssiOut);

                  // --- Beslut ---
                  Shelly.call("Switch.GetStatus", { id: SWITCH_ID }, function (fanStatus) {
                    try{
                      let fanIsOn = !!(fanStatus && fanStatus.output);
                      let startHyst = FAN_ON_HYSTERESIS + (isOutdoorEmergency ? EXTRA_HYST_EMERG_OUT : 0);

                      // Villkor för säker ventilation:
                      // 1) Torrare ute: AF_out < AF_in - startHyst
                      // 2) Svalare ute: T_out < T_in
                      let cond_drier  = AF_out < (AF_in - startHyst);
                      let cond_cooler = T_out < T_in;

                      // önskat läge utan anti-chatter
                      let desired0 = fanIsOn;
                      let reason = "";

                      if (T_out < MIN_OUTDOOR_TEMP){
                        desired0 = false;
                        reason = "För kallt utomhus (" + T_out.toFixed(1) + "°C < " + MIN_OUTDOOR_TEMP + "°C).";
                      } else {
                        if (isIndoorEmergency){
                          // Inne antas fuktigt – men vi kräver ändå båda villkoren för att starta
                          if (!fanIsOn && cond_drier && cond_cooler){
                            desired0 = true;  reason = "Nöd-läge inne: Startar (UTE torrare OCH svalare), hyst=" + startHyst.toFixed(1);
                          } else if (fanIsOn && (!cond_drier || !cond_cooler)){
                            desired0 = false; reason = "Nöd-läge inne: Stoppar (villkor uppfylls ej: " +
                              (cond_drier ? "" : "AF ") + (cond_cooler ? "" : "T ") + ").";
                          } else {
                            desired0 = fanIsOn; reason = "Nöd-läge inne: Ingen ändring.";
                          }
                        } else {
                          // Normal drift – stäng även om RF inne blivit låg
                          if (RH_in < MIN_INDOOR_RH_TARGET){
                            desired0 = false; reason = "Grunden är torr (RF inne " + RH_in.toFixed(1) + "% < " + MIN_INDOOR_RH_TARGET + "%).";
                          } else if (!fanIsOn && cond_drier && cond_cooler){
                            desired0 = true;  reason = "Startar: UTE torrare (" + AF_out.toFixed(2) + " < " + AF_in.toFixed(2) + " - " + startHyst.toFixed(1) + ") OCH svalare (" + T_out.toFixed(1) + " < " + T_in.toFixed(1) + ").";
                          } else if (fanIsOn && (!cond_drier || !cond_cooler)){
                            desired0 = false; reason = "Stoppar: villkor uppfylls ej längre (kräver torrare OCH svalare ute).";
                          } else {
                            desired0 = fanIsOn; reason = "Ingen ändring av förhållanden.";
                          }
                        }
                      }

                      // --- Anti-chatter: block/clear + logg ---
                      let now = nowSec();
                      let elapsed = now - lastSwitchChangeTs;

                      let desired = desired0;
                      let onBlockedNow = false;
                      let offBlockedNow = false;

                      if (fanIsOn && !desired0 && elapsed < MIN_ON_TIME_S){
                        let remain = MIN_ON_TIME_S - elapsed;
                        reason += " | Blockerat: MIN_ON_TIME " + MIN_ON_TIME_S + "s, kvar " + remain + "s.";
                        desired = true;
                        onBlockedNow = true;
                      }
                      if (!fanIsOn && desired0 && elapsed < MIN_OFF_TIME_S){
                        let remain = MIN_OFF_TIME_S - elapsed;
                        reason += " | Blockerat: MIN_OFF_TIME " + MIN_OFF_TIME_S + "s, kvar " + remain + "s.";
                        desired = false;
                        offBlockedNow = true;
                      }

                      // Logga när block släpper (flankdetektering)
                      if (wasOnBlocked && !onBlockedNow){
                        console.log("✅ Min ON-tid uppfylld – avstängning tillåten igen.");
                      }
                      if (wasOffBlocked && !offBlockedNow){
                        console.log("✅ Min OFF-tid uppfylld – start tillåten igen.");
                      }
                      wasOnBlocked  = onBlockedNow;
                      wasOffBlocked = offBlockedNow;

                      console.log("Villkor: drier=" + cond_drier + ", cooler=" + cond_cooler + ", hyst=" + startHyst.toFixed(1));
                      console.log("Beslut: " + (desired ? "KÖR FLÄKT" : "STANNA FLÄKT") + ". Anledning: " + reason);

                      if (fanIsOn !== desired){
                        Shelly.call("Switch.Set", { id: SWITCH_ID, on: desired }, function(res, err){
                          if (err) {
                            console.log("Fel vid Switch.Set:", JSON.stringify(err));
                          } else {
                            console.log("!!! Fläktstatus ändrad till:", (desired ? "PÅ" : "AV"));
                            lastSwitchState = desired;
                            lastSwitchChangeTs = nowSec();
                          }
                        });
                      }
                    } catch(e3){
                      console.log("Fel i besluts-/switchlogik:", e3);
                    }
                  });

                }); // IN_DEV
              });   // OUT_DEV
            });     // IN_RH
          });       // IN_T
        });         // OUT_RH
      });           // OUT_T
    });
  } catch(e){
    console.log("Oväntat fel i controlFanLogic:", e);
  }
}

Timer.set(UPDATE_INTERVAL_S * 1000, true, controlFanLogic);
controlFanLogic();
console.log("Krypgrundsfläkt-skript startat (BTHome, AF+T villkor, 30 min min-tider, extra marginal, ålder/RSSI, block-clear logg).");
