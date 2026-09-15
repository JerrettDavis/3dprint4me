# Portfolio Sources and Content Notes

## Public profiles supplied for the project

- Printables: https://www.printables.com/@Jdsfighter
- Cults3D: https://cults3d.com/en/users/JerrettDavis/3d-models
- Thingiverse example: https://www.thingiverse.com/thing:6230499

The site links to those public sources and uses selected model-listing images uploaded under Jerrett Davis's Cults3D profile, with the owner's approval for storefront use. The images are hosted locally rather than hotlinked; they are project images, not marketplace screenshots or community makes. Other artwork in `public/assets/images/portfolio/` is an original SVG interpretation created for this repository.

## Owner-approved original work

On 2026-09-14, Jerrett reviewed the Fusion project candidates individually and approved these three original projects for public display:

| Local image | Fusion document | What the render shows |
|---|---|---|
| `projects/designed/keyswitch-tester.png` | `Keyswitch Tester` | Mechanical test assembly, actuator travel, switch fixture, guides, and base |
| `projects/designed/power-brick-holder.png` | `Magnetic Power Brick Holder` | Fitted holder, mounting slots, and retained hardware |
| `projects/designed/ratgdo-holster.png` | `Ratgdo Holster_Holder` | Electronics carrier, retention geometry, cable clearance, and mounting features |

The images were captured from the owner's Fusion documents through the local Fusion MCP connection. Construction geometry was hidden for presentation, solid bodies were shown with their saved appearances, and the source documents were closed without saving those view-only changes.

Unapproved and third-party candidates remain outside the repository and public site. A logo-conversion project was removed because permission to publish the source artwork has not been obtained.

| Local image | Listing source | Original listing image |
|---|---|---|
| `projects/ioniq-console-organizer.png` | [Ioniq 5 center-console organizer](https://cults3d.com/en/3d-model/game/fully-parametric-ioniq-5-center-console-organizer) | Cults3D listing photo of the printed tray in the car |
| `projects/ender-skr2-pi-housing.png` | [Ender 3 Pro SKR 2 housing](https://cults3d.com/en/3d-model/tool/ender-3-pro-skr-2-housing-with-pi-4-mount) | `Completed-With-Components.PNG` |
| `projects/pi-camera-ir-enclosure.png` | [Raspberry Pi camera and IR enclosure](https://cults3d.com/en/3d-model/tool/enclosure-for-raspberry-pi-camera-with-ir-modules) | `Top_Shot_with_Camera.png` |
| `projects/alitove-psu-cover.png` | [ALITOVE 5V 70A cover](https://cults3d.com/en/3d-model/tool/alitove-5v-power-supply-70a-350w-enclosure) | `Bottom_Cover.png` |
| `projects/esp32-rfid-dashboard.jpg` | [ESP32-S3 touchscreen RFID dashboard case](https://www.printables.com/model/1745185-esp32-s3-28-touchscreen-rfid-dashboard-case) | `20260604_230932.jpg` |
| `projects/emergency-stop-render.png` | [Emergency-stop button mount](https://cults3d.com/en/3d-model/gadget/emergency-stop-button-mount) | `emergency-button-mount.png` |

## Published work used to establish direction

The profile review showed a strong pattern of functional, fitted, and electronics-oriented design. Representative published titles include:

- Fully Parametric Ioniq 5 Center Console Organizer
- Enclosure for Raspberry Pi Camera with IR Modules
- Ender 3 Pro SKR 2 Housing - With Pi 4 Mount
- A toolless IR Pi Cam Enclosure
- Pi Ribbon Cable Retainer Clip
- ESP32-S3 2.8-inch Touchscreen RFID Dashboard Case
- ALITOVE 5V Power Supply 70A 350W Enclosure
- EZOut v2 Filament Runout Sensor Mount for Micro Swiss Direct Drive
- FLSun Delta Probe Housing
- Ender 3 Pro PSU Cabinet Mount
- Emergency Stop Button Mount
- Ender 3 Pro SKR 2 Front Housing

These works support the site positioning around:

- Measured fit and parametric adjustment
- Automotive organization
- Printer electronics and upgrades
- Camera, display, SBC, sensor, and RFID integration
- Airflow, guarding, access, and cable routing
- Practical machine and shop hardware

## Selected site cards

| Site card | Why it was selected | Current destination |
|---|---|---|
| Ioniq 5 organizer | Strong parametric/fitted consumer example | Direct Cults3D model page (verified author and model details on 2026-09-13) |
| Ender SKR 2/Pi housing | Combines controller, SBC, cooling, cable, and service constraints | Cults3D profile |
| Raspberry Pi camera/IR enclosures | Shows small electronics fit and toolless thinking | Printables profile |
| ALITOVE 70A PSU enclosure | Shows airflow, terminal access, strain relief, and safety-adjacent design | Cults3D profile |
| ESP32 touchscreen RFID dashboard | Connects CAD, embedded electronics, display, and presentation | Printables profile |
| Emergency-stop button mount | Demonstrates shop hardware and human reach constraints | Cults3D profile |

## Before public launch

- Confirm every direct marketplace URL still resolves.
- Replace profile links with direct model links where available.
- Add further real project photography only when the image is owned or licensed for this site; a marketplace user's make is not automatically the model author's photograph.
- Do not imply that public downloads are customer commissions unless they were.
- Preserve the source platform's model license and attribution requirements.
- Remove download/follower counts from marketing copy unless there is a reason to maintain them.
- Obtain written permission before showing customer objects, identifying details, or proprietary geometry.

## Adding a new project

A useful portfolio entry should answer:

1. What problem or constraint existed?
2. What physical interfaces had to fit?
3. What manufacturing decisions mattered?
4. What electronics, hardware, airflow, load, or serviceability constraints were handled?
5. What was validated physically?
6. What result can be shown without exposing private information?

Prefer this structure:

```text
Title
One-sentence problem
Two or three notable constraints
Material/process or validation detail
Outcome
Owned image or original illustration
Source/permission note
```
