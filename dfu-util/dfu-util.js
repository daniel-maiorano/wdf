// ping!
var device = null;

var vConnectMessage="Press and hold the programm button on device.Then plug the USB cable on it. Then, click on the \"Connect\" button";
var vDisconnectMessage="Now press on \"Flash\" button to write the latest firmware.";
var vStatusDisconnected="Device not connected";
var vStatusConnected="Device connected";
var styleOk = "background: #2c8898; color: #f9f9f9;";
var styleWarn = "background: ligthyellow; color: #f9f9f9;";
var styleErr = "background: #982c61; color: #f9f9f9;";
var binFile = "./firmware-RTM-1.2.1.bin";
var binFileDesc = "Firmware version 1.2.1 ready to flash";

(function() {
    'use strict';

    function hex4(n) {
        let s = n.toString(16)
        while (s.length < 4) {
            s = '0' + s;
        }
        return s;
    }

    function hexAddr8(n) {
        let s = n.toString(16)
        while (s.length < 8) {
            s = '0' + s;
        }
        return "0x" + s;
    }

    function niceSize(n) {
        const gigabyte = 1024 * 1024 * 1024;
        const megabyte = 1024 * 1024;
        const kilobyte = 1024;
        if (n >= gigabyte) {
            return n / gigabyte + "GiB";
        } else if (n >= megabyte) {
            return n / megabyte + "MiB";
        } else if (n >= kilobyte) {
            return n / kilobyte + "KiB";
        } else {
            return n + "B";
        }
    }

    function formatDFUInterfaceAlternate(settings) {
        let mode = "Unknown"
        if (settings.alternate.interfaceProtocol == 0x01) {
            mode = "Runtime";
        } else if (settings.alternate.interfaceProtocol == 0x02) {
            mode = "DFU";
        }

        const cfg = settings.configuration.configurationValue;
        const intf = settings["interface"].interfaceNumber;
        const alt = settings.alternate.alternateSetting;
        const name = (settings.name) ? settings.name : "UNKNOWN";

        return `${mode}: cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}"`;
    }

    async function fixInterfaceNames(device_, interfaces) {
        // Check if any interface names were not read correctly
        if (interfaces.some(intf => (intf.name == null))) {
            // Manually retrieve the interface name string descriptors
            let tempDevice = new dfu.Device(device_, interfaces[0]);
            await tempDevice.device_.open();
            await tempDevice.device_.selectConfiguration(1);
            let mapping = await tempDevice.readInterfaceNames();
            await tempDevice.close();

            for (let intf of interfaces) {
                if (intf.name === null) {
                    let configIndex = intf.configuration.configurationValue;
                    let intfNumber = intf["interface"].interfaceNumber;
                    let alt = intf.alternate.alternateSetting;
                    intf.name = mapping[configIndex][intfNumber][alt];
                }
            }
        }
    }

    function populateInterfaceList(form, device_, interfaces) {
        let old_choices = Array.from(form.getElementsByTagName("div"));
        for (let radio_div of old_choices) {
            form.removeChild(radio_div);
        }

        let button = form.getElementsByTagName("button")[0];

        for (let i=0; i < interfaces.length; i++) {
            let radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "interfaceIndex";
            radio.value = i;
            radio.id = "interface" + i;
            radio.required = true;

            let label = document.createElement("label");
            label.textContent = formatDFUInterfaceAlternate(interfaces[i]);
            label.className = "radio"
            label.setAttribute("for", "interface" + i);

            let div = document.createElement("div");
            div.appendChild(radio);
            div.appendChild(label);
            form.insertBefore(div, button);
        }
    }

    function getDFUDescriptorProperties(device) {
        // Attempt to read the DFU functional descriptor
        // TODO: read the selected configuration's descriptor
        return device.readConfigurationDescriptor(0).then(
            data => {
                let configDesc = dfu.parseConfigurationDescriptor(data);
                let funcDesc = null;
                let configValue = device.settings.configuration.configurationValue;
                if (configDesc.bConfigurationValue == configValue) {
                    for (let desc of configDesc.descriptors) {
                        if (desc.bDescriptorType == 0x21 && desc.hasOwnProperty("bcdDFUVersion")) {
                            funcDesc = desc;
                            break;
                        }
                    }
                }

                if (funcDesc) {
                    return {
                        WillDetach:            ((funcDesc.bmAttributes & 0x08) != 0),
                        ManifestationTolerant: ((funcDesc.bmAttributes & 0x04) != 0),
                        CanUpload:             ((funcDesc.bmAttributes & 0x02) != 0),
                        CanDnload:             ((funcDesc.bmAttributes & 0x01) != 0),
                        TransferSize:          funcDesc.wTransferSize,
                        DetachTimeOut:         funcDesc.wDetachTimeOut,
                        DFUVersion:            funcDesc.bcdDFUVersion
                    };
                } else {
                    return {};
                }
            },
            error => {}
        );
    }

    // Current log div element to append to
    let logContext = null;

    function setLogContext(div) {
        logContext = div;
    };

    function clearLog(context) {
        if (typeof context === 'undefined') {
            context = logContext;
        }
        if (context) {
            context.innerHTML = "";
        }
    }

    function logDebug(msg) {
        console.log(msg);
    }

    function logInfo(msg) {
        if (logContext) {
            let info = document.createElement("p");
            info.className = "info";
            info.textContent = msg;
            logContext.appendChild(info);
        }
    }

    function logWarning(msg) {
        if (logContext) {
            let warning = document.createElement("p");
            warning.className = "warning";
            warning.textContent = msg;
            logContext.appendChild(warning);
        }
    }

    function logError(msg) {
        if (logContext) {
            let error = document.createElement("p");
            error.className = "error";
            error.textContent = msg;
            logContext.appendChild(error);
        }
    }

    function logProgress( task, done, total) {
        if (logContext) {
            let progressBar;
            let myProgress;
            if (logContext.lastChild.tagName.toLowerCase() == "p") {
                myProgress = logContext.lastChild;
            }
            if (!myProgress) {
                myProgress = document.createElement("p");
            }
            myProgress.textContent=task;
            if(myProgress.lastChild.tagName == "progress"){
                progressBar = logContext.lastChild;
            }
            if (!progressBar) {
                progressBar = document.createElement("progress");
                myProgress.appendChild(progressBar);
            }
            progressBar.value = done;
            if (typeof total !== 'undefined') {
                progressBar.max = total;
            }
            progressBar.value = done;
            if (typeof total !== 'undefined') {
                progressBar.max = total;
            }
        }
    }

    document.addEventListener('DOMContentLoaded', event => {
        let connectButton = document.querySelector("#connect");
        let downloadButton = document.querySelector("#download");
        let statusDisplay = document.querySelector("#status");
        let statusField = document.querySelector("#statusField");
        let vidField = "";
        let interfaceForm = document.querySelector("#interfaceForm");
        let interfaceSelectButton = document.querySelector("#selectInterface");
        let connectMessage = document.querySelector("#connectMessage");

        let searchParams = new URLSearchParams(window.location.search);
        let fromLandingPage = false;
        let vid = 0;
        
        // Set the vendor ID from the landing page URL
        if (searchParams.has("vid")) {
            const vidString = searchParams.get("vid");
            try {
                if (vidString.toLowerCase().startsWith("0x")) {
                    vid = parseInt(vidString, 16);
                } else {
                    vid = parseInt(vidString, 10);
                }
                vidField = "0x" + hex4(vid).toUpperCase();
                fromLandingPage = true;
            } catch (error) {
                console.log("Bad VID " + vidString + ":" + error);
            }
        }
        
        // Grab the serial number from the landing page
        let serial = "";
        if (searchParams.has("serial")) {
            serial = searchParams.get("serial");
            // Workaround for Chromium issue 339054
            if (window.location.search.endsWith("/") && serial.endsWith("/")) {
                serial = serial.substring(0, serial.length-1);
            }
            fromLandingPage = true;
        }

        let configForm = document.querySelector("#configForm");

        let transferSizeField = document.querySelector("#transferSize");
        let transferSize = parseInt(transferSizeField.value);

        let dfuseStartAddressField = document.querySelector("#dfuseStartAddress");
        let dfuseUploadSizeField = document.querySelector("#dfuseUploadSize");

        let firmwareFile = null;

        fetch(binFile)
        .then(res => res.blob()) // Gets the response and returns it as a blob
        .then(blob => {
            // Here's where you get access to the blob
            // And you can use it for whatever you want
            // Like calling ref().put(blob)

            // Here, I use it to make an image appear on the page
            let reader = new FileReader();
            reader.onload = function() {
                firmwareFile = reader.result;
            }
            reader.readAsArrayBuffer(blob);
        });
        
        let downloadLog = document.querySelector("#downloadLog");
        setLogContext(downloadLog);
        clearLog(downloadLog);
        logInfo(binFileDesc);

        let manifestationTolerant = true;

        statusDisplay.textContent = vStatusDisconnected;
        statusField.setAttribute("style",styleErr);
        //let device;

        function onDisconnect(reason) {
            if (reason) {
                statusDisplay.textContent = vStatusDisconnected+" "+reason;
            }else{
                statusDisplay.textContent = vStatusDisconnected;
            }
            statusField.setAttribute("style",styleErr);

            connectButton.textContent = "Connect";
            downloadButton.disabled = true;
            connectMessage.textContent = vConnectMessage;
        }

        function onUnexpectedDisconnect(event) {
            if (device !== null && device.device_ !== null) {
                if (device.device_ === event.device) {
                    device.disconnected = true;
                    onDisconnect("Unexpected event");
                    device = null;
                }
            }
        }

        async function connect(device) {
            try {
                await device.open();
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            // Attempt to parse the DFU functional descriptor
            let desc = {};
            try {
                desc = await getDFUDescriptorProperties(device);
            } catch (error) {
                onDisconnect(error);
                throw error;
            }

            let memorySummary = "";
            if (desc && Object.keys(desc).length > 0) {
                device.properties = desc;

                transferSizeField.value = desc.TransferSize;
                transferSize = desc.TransferSize;
                if (desc.CanDnload) {
                    manifestationTolerant = desc.ManifestationTolerant;
                }

                if (device.settings.alternate.interfaceProtocol == 0x02) {
                    if (!desc.CanUpload) {
                        dfuseUploadSizeField.disabled = true;
                    }
                    if (!desc.CanDnload) {
                        dnloadButton.disabled = true;
                    }
                }

                if (desc.DFUVersion == 0x011a && device.settings.alternate.interfaceProtocol == 0x02) {
                    device = new dfuse.Device(device.device_, device.settings);
                    if (device.memoryInfo) {
                        let totalSize = 0;
                        for (let segment of device.memoryInfo.segments) {
                            totalSize += segment.end - segment.start;
                        }
                        memorySummary = `Selected memory region: ${device.memoryInfo.name} (${niceSize(totalSize)})`;
                        for (let segment of device.memoryInfo.segments) {
                            let properties = [];
                            if (segment.readable) {
                                properties.push("readable");
                            }
                            if (segment.erasable) {
                                properties.push("erasable");
                            }
                            if (segment.writable) {
                                properties.push("writable");
                            }
                            let propertySummary = properties.join(", ");
                            if (!propertySummary) {
                                propertySummary = "inaccessible";
                            }

                            memorySummary += `\n${hexAddr8(segment.start)}-${hexAddr8(segment.end-1)} (${propertySummary})`;
                        }
                    }
                }
            }

            // Bind logging methods
            device.logDebug = logDebug;
            device.logInfo = logInfo;
            device.logWarning = logWarning;
            device.logError = logError;
            device.logProgress = logProgress;

            // Clear logs
            clearLog(downloadLog);

            // Display basic USB information
            statusDisplay.textContent = '';
            connectButton.textContent = 'Disconnect';
            connectMessage.textContent = vDisconnectMessage;
            statusDisplay.textContent = vStatusConnected;
            statusField.setAttribute("style",styleOk);

            // Update buttons based on capabilities
            if (device.settings.alternate.interfaceProtocol == 0x01) {

                downloadButton.disabled = true;
            } else {
 
                downloadButton.disabled = false;
            }

            if (device.memoryInfo&&1==2) {
                let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                dfuseFieldsDiv.hidden = false;
                dfuseStartAddressField.disabled = false;
                dfuseUploadSizeField.disabled = false;
                let segment = device.getFirstWritableSegment();
                if (segment) {
                    device.startAddress = segment.start;
                    dfuseStartAddressField.value = "0x" + segment.start.toString(16);
                    const maxReadSize = device.getMaxReadSize(segment.start);
                    dfuseUploadSizeField.value = maxReadSize;
                    dfuseUploadSizeField.max = maxReadSize;
                }
            } else {
                let dfuseFieldsDiv = document.querySelector("#dfuseFields")
                dfuseFieldsDiv.hidden = true;
                dfuseStartAddressField.disabled = true;
                dfuseUploadSizeField.disabled = true;
            }

            return device;
        }

        function autoConnect(vid, serial) {
            dfu.findAllDfuInterfaces().then(
                async dfu_devices => {
                    let matching_devices = [];
                    for (let dfu_device of dfu_devices) {
                        if (serial) {
                            console.log("serial="+dfu_device.device_.serialNumber);
                            if (dfu_device.device_.serialNumber == serial) {
                                matching_devices.push(dfu_device);
                            }
                        } else if (dfu_device.device_.vendorId == vid) {
                            matching_devices.push(dfu_device);
                        }
                    }

                    if (matching_devices.length == 0) {
                        statusDisplay.textContent = 'No device found.';
                        statusField.setAttribute("style",styleErr);
                    } else {
 
                        if (matching_devices.length == 1) {
                            statusDisplay.textContent = 'Connecting...';
                            statusField.setAttribute("style",styleWarn);
                            device = matching_devices[0];
                            console.log(device);
                            device = await connect(device);
                        } else {
                            statusDisplay.textContent = "Multiple DFU interfaces found.";
                            statusField.setAttribute("style",styleWarn);
                            let interfaces = dfu.findDeviceDfuInterfaces(matching_devices[0].device_);
                            await fixInterfaceNames(matching_devices[0].device_, interfaces);
                            device = await connect(new dfu.Device(matching_devices[0].device_, interfaces[0]));
                        }
                        vidField = "0x" + hex4(matching_devices[0].device_.vendorId).toUpperCase();
                        vid = matching_devices[0].device_.vendorId;
                    }
                }
            );
        }


        // transferSizeField.addEventListener("change", function() {
        //    transferSize = parseInt(transferSizeField.value);
        // });

        /*
        dfuseStartAddressField.addEventListener("change", function(event) {
            const field = event.target;
            let address = parseInt(field.value, 16);
            if (isNaN(address)) {
                field.setCustomValidity("Invalid hexadecimal start address");
            } else if (device && device.memoryInfo) {
                if (device.getSegment(address) !== null) {
                    device.startAddress = address;
                    field.setCustomValidity("");
                    dfuseUploadSizeField.max = device.getMaxReadSize(address);
                } else {
                    field.setCustomValidity("Address outside of memory map");
                }
            } else {
                field.setCustomValidity("");
            }
        });
        */

        connectButton.addEventListener('click', function() {
            if (device) {
                device.close().then(onDisconnect);
                device = null;
            } else {
                let filters = [];
                if (serial) {
                    filters.push({ 'serialNumber': serial });
                } else if (vid) {
                    filters.push({ 'vendorId': vid });
                } else {
                    filters.push({ 'vendorId': 0x0483});
                }
                navigator.usb.requestDevice({ 'filters': filters }).then(
                    async selectedDevice => {
                        let interfaces = dfu.findDeviceDfuInterfaces(selectedDevice);
                        if (interfaces.length == 0) {
                            console.log(selectedDevice);
                            statusDisplay.textContent = "The selected device does not have any USB DFU interfaces.";
                            statusField.setAttribute("style",styleWarn);
                        } else if (interfaces.length == 1) {
                            await fixInterfaceNames(selectedDevice, interfaces);
                            device = await connect(new dfu.Device(selectedDevice, interfaces[0]));
                        } else {

                            await fixInterfaceNames(selectedDevice, interfaces);
                            populateInterfaceList(interfaceForm, selectedDevice, interfaces);
                            device = await connect(new dfu.Device(selectedDevice, interfaces[0]));
                        }
                    }
                ).catch(error => {
                    statusDisplay.textContent = error;
                    statusField.setAttribute("style",styleErr);
                });
            }
        });


        downloadButton.addEventListener('click', async function(event) {
            event.preventDefault();
            event.stopPropagation();
            if (!configForm.checkValidity()) {
                configForm.reportValidity();
                return false;
            }



            if (device && firmwareFile != null) {
                setLogContext(downloadLog);
                clearLog(downloadLog);
                try {
                    let status = await device.getStatus();
                    if (status.state == dfu.dfuERROR) {
                        await device.clearStatus();
                    }
                } catch (error) {
                    device.logWarning("Failed to clear status");
                }
                await device.do_download(transferSize, firmwareFile, manifestationTolerant).then(
                    () => {
                        clearLog(downloadLog);
                        logInfo("Done!");
                        setLogContext(null);
                        if (!manifestationTolerant) {
                            device.waitDisconnected(5000).then(
                                dev => {
                                    onDisconnect();
                                    device = null;
                                },
                                error => {
                                    // It didn't reset and disconnect for some reason...
                                    console.log("Device unexpectedly tolerated manifestation.");
                                }
                            );
                        }
                    },
                    error => {
                        logError(error);
                        setLogContext(null);
                    }
                )
            }

            //return false;
        });

        // Check if WebUSB is available
        if (typeof navigator.usb !== 'undefined') {
            navigator.usb.addEventListener("disconnect", onUnexpectedDisconnect);
            // Try connecting automatically
            if (fromLandingPage) {
                autoConnect(vid, serial);
            }
        } else {
            statusDisplay.textContent = 'WebUSB not available.'
            statusField.setAttribute("style",styleErr);
            connectButton.disabled = true;
        }
    });
})();
