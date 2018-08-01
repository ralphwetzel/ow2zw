/*** 1-Wire to Z-Way HA module *******************************************

 Version: 1.00
 (c) Ralph Wetzel
 -----------------------------------------------------------------------------
 Author: Ralph Wetzel <ralph.wetzel@gmx.de>
 Description: This module allows to access 1-Wire(R) sensor data provided by owserver from Z-Wave.me

 ******************************************************************************/
'use strict';

function ow2zw(id, controller) {
    // Call superconstructor first (AutomationModule)
    ow2zw.super_.call(this, id, controller);

    var self = this;

    self.vDev           = {};
    self.interval          = undefined;

    executeFile(self.moduleBasePath() + "/owclient.js");

}

inherits(ow2zw, AutomationModule);

_module = ow2zw;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

ow2zw.prototype.init = function (config) {
    ow2zw.super_.prototype.init.call(this, config);

    var self = this;

    var langFile = self.controller.loadModuleLang("ow2zw");

    self.value = null;
    self.ip = (config.ows.ip || "127.0.0.1").toString();
    self.port = config.ows.port || 4304;
    self.sensor_id = config.sensor.id.toString();
    self.sensor_path = config.sensor.path.toString();
    // self.sensor_type = config.sensor.typ.toString();
    // self.sensor_unit = config.sensor.unit;

    self.scale = parseFloat(config.data.scale) || 1.0;

    self.diff = (config.data.typ === "diff");
    self.diff_last_value = null;
    self.diff_last_time = null;

    var sb = {
        "default": 1.0,
        "s": 1 * 1000.0,
        "m": 60 * 1000.0,
        "h": 3600 * 1000.0
    };
    self.diff_base = sb[config.data.base || "default"] || 1.0;

    self.rate = config.advanced.rate || 60;
    self.hyst = parseFloat(config.advanced.hyst) || 0.0;
    self.alarm = config.advanced.alarm || false;

    self.debug_once_done = false;
    self.debug_once_done_alarm = false;

    // self.serverIP = "";
    // self.serverPort = 0;

    if (self.sensor_path.length > 0) {
        var c = self.sensor_path[0];
        if (c === "/" || c === "\\") {
            self.sensor_path = self.sensor_path.slice(1);
        }
        c = self.sensor_path[-1];
        if (c === "/" || c === "\\") {
            self.sensor_path = self.sensor_path.slice(0, -1);
        }
    }

    self.unit = config.display.unit || "";
    if (self.unit === "cstm") {
        self.unit = config.display.unit_custom.toString()
    }

    self.vDev = self.controller.devices.create({
        deviceId: "ow2zw_"+self.id,
        defaults: {
            deviceType: "sensorMultilevel",
            probeType: config.display.typ || "",
            metrics: {
                title: '1-Wire: ' + self.sensor_id,
                icon: config.display.icon || "",
                // probeTitle: "Temperature",
                scaleTitle: '',
                level: 0
            }
        },
        overlay: {
            metrics: {
            }
        },
        moduleId: self.id,
        handler:  function (command, args) {
            switch(command){
                case "update":
                    self.poll(true);
                    break;
                default:
                    ow2zw.super_.prototype.performCommand.call(this, command);
            }
        },
    });

    self.vAlarm = null;

    if (self.alarm === true) {

        var owc = new owClient(self.ip, self.port, true);

        owc.present(self.sensor_id, function(err, result) {
            if (err) {
                owc.dump("Failed to create alarming device: " + err.message);
            } else {

                self.alarm_id = result.toString(16).toUpperCase();

                self.vAlarm = self.controller.devices.create({
                    deviceId: "ow2zw_" + self.id + "_alarm",
                    defaults: {
                        deviceType: "sensorBinary",
                        probeType: 'alarm_heat',
                        metrics: {
                            icon: 'alarm',
                            title: '1-Wire: ' + self.sensor_id,
                            probeTitle: "Alarm"
                        }
                    },
                    overlay: {
                        metrics: {
                        }
                    },
                    moduleId: self.id,
                    handler:  function (command, args) {
                        switch(command){
                            case "update":
                                self.poll_alarm(true);
                                break;
                            default:
                                ow2zw.super_.prototype.performCommand.call(this, command);
                        }
                    },
                });
                self.poll_alarm();
            }
        })

    }

    self.interval = setInterval(function() {
        self.poll(true);
        self.poll_alarm();
    }, self.rate*1000);

    self.poll();

};

ow2zw.prototype.stop = function () {
    var self = this;

    self.controller.devices.remove(self.vDev.id);
    self.vDev = undefined;

    if (self.vAlarm !== null) {
        self.controller.devices.remove(self.vAlarm.id);
        self.vAlarm = undefined;
    }

    clearInterval(self.interval);
    self.interval = undefined;

    ow2zw.super_.prototype.stop.call(self);
};


// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

ow2zw.prototype.poll = function (force) {

    var self = this;

    // The client to connect to owswerver
    var owc = new owClient(self.ip, self.port, true);

    var now = new Date().getTime();

    owc.read("/" + self.sensor_id + "/" + self.sensor_path, function (err, result) {
        if (err) {
            owc.dump("Error: " + err.message);
            self.debug_once_done = false;
            self.vDev.set("metrics:scaleTitle", "");
            self.vDev.set("metrics:level", "Error");
        } else {
            if (self.debug_once_done === false) {
                owc.dump("Communication successful. Further messages will be suppressed!");
                self.debug_once_done = true;
            }
            var rv = parseFloat(result.value);

            var value_delta = 0;
            var time_delta = 1;

            debugPrint(value_delta, time_delta, rv);

            if (self.diff) {

                if (self.diff_last_value) {
                    value_delta = rv - self.diff_last_value;
                    time_delta = now - self.diff_last_time;
                }

                self.diff_last_value = rv;
                self.diff_last_time = now;

                rv = (self.diff_base / time_delta) * value_delta;
                // rv = (value_delta / time_delta) / self.diff_base;
            }

            rv = rv * self.scale;

            debugPrint(value_delta, time_delta, rv);

            if (self.value === null || force === true || Math.abs(self.value - rv) >= self.hyst) {
                self.vDev.set("metrics:level", rv);
                self.value = rv;

                switch (self.unit) {
                    case "temp":
                        self.vDev.set("metrics:scaleTitle", result.temperature());
                        break;
                    case "pres":
                        self.vDev.set("metrics:scaleTitle", result.pressure());
                        break;
                    default:
                        self.vDev.set("metrics:scaleTitle", self.unit);
                }
            }
        }
    });
};

ow2zw.prototype.poll_alarm = function () {

    var self = this;
    if (self.vAlarm !== null) {

        var owcAlarm = new owClient(self.ip, self.port, true);

        // var flags = owClient.communication.flags.request | owClient.communication.flags.alias | owClient.communication.flags.fic;
        var flags = 0x05000108;
        owcAlarm.setFlags(flags);

        owcAlarm.dir("/alarm", function(err, result) {
            if (err) {
                owcAlarm.dump("Error: " + err.message);
            } else {
                var level = false;
                for (var i=0; i<result.length; i++) {
                    var devs = result[i].split("/");
                    if (devs.length > 2) {
                        // expected devs format: ["", "alarm", alarm_id]
                        if (devs[2] === self.alarm_id) {
                            level = true;
                            break;
                        }
                    }
                }
                self.vAlarm.set("metrics:level", level === true ? "on" : "off");
            }
        });
    }
};

/*
ow2zw.prototype.updateCalculation = function () {
    var self        = this;
    //var langFile    = self.controller.loadModuleLang("Astronomy");
    var now         = new Date();
    var position    = SunCalc.getPosition(now, self.config.latitude, self.config.longitude);
    var times       = SunCalc.getTimes(now, self.config.latitude, self.config.longitude);
    var azimuth     = position.azimuth * 180 / Math.PI + 180;
    var altitude    = position.altitude * 180 / Math.PI;
    var previous    = parseFloat(self.vDev.altitude.get("metrics:level") || altitude);
    var mode;

    console.log("[Astronomy] Calculate");
    if (altitude < -2) {
        mode = 'night';
    } else {
        mode = 'day';
    }

    if (! _.isUndefined(self.vDev.altitude)) {
        self.vDev.altitude.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/Astronomy/altitude_"+mode+".png");
        self.vDev.altitude.set("metrics:level",altitude);
        self.vDev.altitude.set("metrics:azimuth",azimuth);
        self.vDev.altitude.set("metrics:altitude",altitude);
        self.vDev.altitude.set("metrics:trend",(previous <= altitude) ? 'rise':'set');
    }

    if (! _.isUndefined(self.vDev.azimuth)) {
        self.vDev.azimuth.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/Astronomy/azimuth_"+mode+".png");
        self.vDev.azimuth.set("metrics:level",azimuth);
        self.vDev.azimuth.set("metrics:azimuth",azimuth);
        self.vDev.azimuth.set("metrics:altitude",altitude);
    }

    _.each(self.events,function(event) {
        if (! _.isUndefined(self.vDev.altitude)) {
            self.vDev.altitude.set("metrics:"+event,times[event]);
        }
        if (times[event].getHours() === now.getHours()
            && times[event].getMinutes() === now.getMinutes()
            && times[event].getDate() === now.getDate()) {
            console.log("[Astronomy] Event "+event);
            self.controller.emit("astronomy."+event);
        }
    });
};
*/
