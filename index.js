const AlertAlarmApi = require('./api')
const packageVersion = require('./package.json').version

module.exports = function(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic

  class AlertAlarmAccessory {
    constructor(platform, device) {
      this.platform = platform
      this.device = device
      this.id = device.id || device.radio_code
      this.uuid_base = this.type + ':' + this.id
    }

    get name() {
      return this.device.name || this.type
    }

    get type() {
      return 'Accessory'
    }

    identify(callback) {
      this.platform.log(this.type, this.id, 'identified')
      callback()
    }

    getServices() {
      let model = this.type
      if (this.device.type) {
        model += ' (' + this.device.type + ')'
      }

      const accessoryInformation = new Service.AccessoryInformation()
        .setCharacteristic(Characteristic.Manufacturer, 'Alert Alarm')
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, String(this.id))
        .setCharacteristic(Characteristic.FirmwareRevision, packageVersion)

      return [accessoryInformation]
    }
  }

  class AlertAlarmSecuritySystem extends AlertAlarmAccessory {
    get type() {
      return 'Security System'
    }

    getServices() {
      const service = new Service.SecuritySystem(this.type)
      const SSCS = Characteristic.SecuritySystemCurrentState
      const SSTS = Characteristic.SecuritySystemTargetState

      this.platform.characteristics['security-system-current-state'] = service
        .getCharacteristic(SSCS)
        .setProps({
          validValues: [SSCS.STAY_ARM, SSCS.AWAY_ARM, SSCS.DISARMED, SSCS.ALARM_TRIGGERED]
        })

      this.platform.characteristics['security-system-target-state'] = service
        .getCharacteristic(SSTS)
        .setProps({
          validValues: [SSTS.STAY_ARM, SSTS.AWAY_ARM, SSTS.DISARM]
        })
        .on('set', (newState, callback) => {
          // TODO: implement this request
          service.getCharacteristic(SSCS).setValue(newState)
          callback()
        })

      return [service].concat(super.getServices())
    }
  }

  class AlertAlarmThermometer extends AlertAlarmAccessory {
    get type() {
      return 'Thermometer'
    }

    getServices() {
      const service = new Service.TemperatureSensor(this.type, this.id)

      this.platform.characteristics['temperature-' + this.id] = service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -100 })

      return [service].concat(super.getServices())
    }
  }

  class AlertAlarmPlatform {
    constructor(log, config) {
      this.log = log
      this.config = config
      this.api = new AlertAlarmApi(config)
      this.lastSeenEventId = 0
      this.characteristics = {}
    }

    accessories(callback) {
      const accessories = [
        new AlertAlarmSecuritySystem(this, { id: '0' })
      ]

      this.api.get('/system/devices', { refresh: 'false' })
        .then(res => {
          for (let device of res.body.data) {
            if (device.temperature_measurements) {
              accessories.push(new AlertAlarmThermometer(this, device))
            }
          }

          this.loadEventLog()

          callback(accessories)
        })
        .catch(err => {
          this.log('An error occurred while loading devices')
          throw err
        })
    }

    loadEventLog() {
      this.api.get('/log/recent', { count: 1000, since_id: this.lastSeenEventId })
        .then(res => {
          this.updateCharacteristics(res.body.data)
        })
        .catch(err => {
          this.log('Failed to load the event log:', err)
        })
        .then(() => {
          setTimeout(
            this.loadEventLog.bind(this),
            this.config.refreshInterval || 10 * 60 * 1000
          )
        })
    }

    updateCharacteristics(events) {
      const characteristics = Object.assign({}, this.characteristics)

      const setValue = (key, value) => {
        const characteristic = characteristics[key]

        if (characteristic) {
          if (value !== characteristic.value) {
            characteristic.setValue(value)
          }
          delete characteristics[key]
        }
      }

      for (let event of events) {
        if (event.id > this.lastSeenEventId) {
          this.lastSeenEventId = event.id
        }

        if (event.log_type === 'activation') {
          const SSCS = Characteristic.SecuritySystemCurrentState
          const SSTS = Characteristic.SecuritySystemTargetState
          const state = event.data.active_group_id

          setValue('security-system-target-state', state >= 0 ? SSTS.AWAY_ARM : SSTS.DISARM)

          if (event.data.activation_progress === 0) {
            setValue('security-system-current-state', state >= 0 ? SSCS.AWAY_ARM : SSCS.DISARMED)
          }
        } else if (event.log_type === 'temperature') {
          setValue('temperature-' + event.data.radio_code, event.data.degrees_celsius)
        }
      }
    }
  }

  homebridge.registerPlatform('homebridge-alert-alarm', 'AlertAlarm', AlertAlarmPlatform)
}
