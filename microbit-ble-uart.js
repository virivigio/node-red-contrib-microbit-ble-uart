module.exports = RED => {
    const noble = require('noble');

    function MicrobitBleUartNode(config) {
        RED.nodes.createNode(this, config);

        // The proprietary UART profile by Nordic Semiconductor
        // https://infocenter.nordicsemi.com/index.jsp?topic=%2Fcom.nordic.infocenter.sdk5.v14.0.0%2Fble_sdk_app_nus_eval.html
        const uartServiceUuid = '6e400001b5a3f393e0a9e50e24dcca9e',
              rxCharacteristicUuid = '6e400002b5a3f393e0a9e50e24dcca9e',
              txCharacteristicUuid = '6e400003b5a3f393e0a9e50e24dcca9e';

        const deviceName = config.deviceName;
        const node = this;
        node.log('Node Opening');

        let rxCharacteristic = null;
        let txCharacteristic = null;
        let writeWithoutResponse = false;
        let device = null;
        

        if (deviceName === "") {
            node.error("Please specify a device name");
        }

        this.on('close', function () {
                node.log('OnClose - Node Closing');
                noble.stopScanning(); 
                if (device) 
                    { device.disconnect(function(err) { if (err) { node.error('Error disconnecting: ' + err) } }); device=null; }    
                noble.removeAllListeners();           
        });

        this.on('input', function(msg) {
            if (msg.payload === 'Connect') { 
                noble.stopScanning();
                if (device) { 
                    node.log('OnInput - Disconnecting device'); 
                    device.disconnect(function(err) { if (err) { node.error('OnInput - Error disconnecting: ' + err) } }); 
                    device=null; }    
                if (noble.state === 'poweredOn')            
                    noble.startScanning([], false, (err) => {if (err) { node.error('OnInput - startScanning error: ' + err) } });
            }
            else
            if (msg.payload === 'Disconnect') { 
                noble.stopScanning(); 
                if (device) 
                    { device.disconnect(function(err) { if (err) { node.error('OnInput - Error disconnecting: ' + err) } }); device=null; }               
            }
            else
            if (txCharacteristic) {
                // You can only send at most 20 bytes in a Bluetooth LE packet,
                // so slice the data into 20-byte chunks:
                while (msg.payload.length > 20) {
                    var output = msg.payload.slice(0, 19);
                    node.log('Writing: '+output);
                    txCharacteristic.write(Buffer.from(output), writeWithoutResponse);
                    msg.payload = data.slice(20);
                }

                // Send any remainder bytes less than the last 20:
                node.log('OnInput - Writing: '+msg.payload);
                txCharacteristic.write(Buffer.from(msg.payload), writeWithoutResponse, function(err) { if (err) { node.error('OnInput - Error writing: ' + err) } });
            }
        });

        noble.on('stateChange', function(state) {
            node.log('OnStateChange - Noble state: '+state);

            if (state === 'poweredOn') {
                node.status({ fill: "blue", shape: "ring", text: "BLE powered on" });
            } else {
                node.status({ fill: "red", shape: "ring", text: "BLE powered off" });
            }
        });

        noble.on('scanStart', function() {
            node.log('OnScanStart - Started scanning');
            node.status({ fill: "blue", shape: "ring", text: "Scanning..." });
        });

        noble.on('scanStop', function() {
            node.log('OnScanStop - Stopped scanning');
            node.status({ fill: "blue", shape: "dot", text: "Scanning finished" });
        });

        noble.on('warning', function(message) {
            node.warn(message);
        });

        noble.on('discover', function(peripheral) {
            node.log('OnDiscover - Discovered: ' + peripheral);

            if (peripheral.advertisement.localName !== deviceName) {
                // Ignore non-specified peripherals
                return;
            }

            // We found a peripheral, stop scanning
            device=peripheral;
            noble.stopScanning();
            node.log('OnDiscover - Found: ' + peripheral.advertisement.localName);
            node.status({ fill: "green", shape: "ring", text: "Device found" });

            peripheral.connect(function(err) {
                if (err) {
                    node.error('OnDiscover - Error connecting: ' + err);
                    return;
                }

                node.log('OnDiscover - Connected to ' + peripheral.advertisement.localName);
                node.status({ fill: "green", shape: "ring", text: "Device connected" });

                peripheral.discoverServices(null, function(err, services) {
                    if (err) {
                        node.error('OnDiscover - Error discovering services: ' + err);
                        return;
                    }

                    node.log('OnDiscover - Services: ' + services.length);
                    services.forEach(function(service) {
                        if (service.uuid == uartServiceUuid) {
                            node.log('OnDiscover - Found a UART service');
  
                            service.discoverCharacteristics(null, function(err, characteristics) {

                                characteristics.forEach(function(characteristic) {
                                    node.log('Found characteristic: '+characteristic.uuid);

                                    if (rxCharacteristicUuid === characteristic.uuid) {
                                        rxCharacteristic = characteristic;
                                        node.log('Found a RX characteristic: '+characteristic.uuid);
                                        node.log('with properties: '+characteristic.properties);
                                    
                                        rxCharacteristic.notify(true);

                                        rxCharacteristic.on('read', function(data, notification) {
                                            node.log('Received: '+data);
                                            var msg = { "payload": data };
                                            node.send(msg);
                                        });

                                    } 
                                    if (txCharacteristicUuid === characteristic.uuid) {
                                        txCharacteristic = characteristic;
                                        node.log('Found a TX characteristic: '+characteristic.uuid);
                                        node.log('with properties: '+characteristic.properties);

                                        if (txCharacteristic.properties.indexOf("writeWithoutResponse") > -1) { writeWithoutResponse = true; }                                    
                                    }
                                }); //foreach characteristic

                                if (txCharacteristic && rxCharacteristic) {
                                    node.log('OnDiscover - Ready');
                                    node.status({ fill: "green", shape: "dot", text: "Device ready" });
                                }
                          });
                        }
                    }); //foreach service

                    node.log('OnDiscover - End of discovery');
                });

                peripheral.once('disconnect', function(err) {
                    node.log('OnceDisconnect - Disconnected');
                    if (err) { node.error('OnceDisconnect - err: ' + err); }

                    // Reset characteristics
                    txCharacteristic = null;
                    rxCharacteristic = null;
                    device = null;
                });
            });
        });
    }

    RED.nodes.registerType("microbit ble uart", MicrobitBleUartNode);
}