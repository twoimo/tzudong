import { acquireDeviceLocationUseAuthorization, evaluateLocationUse, revokeDeviceLocationUseAuthorization, DEVICE_LOCATION_NETWORK_SINK } from "../../../lib/privacy/location-gate";
let authorization: Awaited<ReturnType<typeof acquireDeviceLocationUseAuthorization>> = null;
const output = document.querySelector("output")!;
const decision = (value = authorization) => evaluateLocationUse({purpose:"home-map-device-marker",destination:"network",networkSink:DEVICE_LOCATION_NETWORK_SINK,authorization:value}).allowed;
(document.querySelector("button") as HTMLButtonElement).onclick = async () => { authorization = await acquireDeviceLocationUseAuthorization(); output.textContent = authorization && decision() ? "권한 준비됨" : "권한 거부됨"; };
Object.assign(window,{probeDecision:decision,probeClone:()=>decision(authorization ? {...authorization}:null),probeExpiry:()=>authorization?.expiresAt??null,probeRevoke:()=>revokeDeviceLocationUseAuthorization(authorization)});
