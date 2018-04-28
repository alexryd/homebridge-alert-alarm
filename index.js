const AlertAlarmApi = require('./api')
const crypto = require('crypto')
const packageVersion = require('./package.json').version

module.exports = function(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic
  const SSCS = Characteristic.SecuritySystemCurrentState
  const SSTS = Characteristic.SecuritySystemTargetState

  const AlarmStatus = {
    ARMED_AWAY: 'ARMED_AWAY',
    ARMED_HOME: 'ARMED_HOME',
    DISARMED: 'DISARMED',

    fromCurrentState: state => {
      if (state === SSCS.AWAY_ARM) {
        return AlarmStatus.ARMED_AWAY
      } else if (state === SSCS.STAY_ARM) {
        return AlarmStatus.ARMED_HOME
      }
      return AlarmStatus.DISARMED
    },

    toCurrentState: status => {
      if (status === AlarmStatus.ARMED_AWAY) {
        return SSCS.AWAY_ARM
      } else if (status === AlarmStatus.ARMED_HOME) {
        return SSCS.STAY_ARM
      }
      return SSCS.DISARMED
    },

    fromTargetState: state => {
      if (state === SSTS.AWAY_ARM) {
        return AlarmStatus.ARMED_AWAY
      } else if (state === SSTS.STAY_ARM) {
        return AlarmStatus.ARMED_HOME
      }
      return AlarmStatus.DISARMED
    },

    toTargetState: status => {
      if (status === AlarmStatus.ARMED_AWAY) {
        return SSTS.AWAY_ARM
      } else if (status === AlarmStatus.ARMED_HOME) {
        return SSTS.STAY_ARM
      }
      return SSTS.DISARM
    },
  }

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
    constructor(platform, device) {
      super(platform, device)

      this.currentStatus = AlarmStatus.DISARMED
    }

    get type() {
      return 'Security System'
    }

    getServices() {
      const service = new Service.SecuritySystem(this.type)

      this.platform.characteristics['security-system-current-state'] = service
        .getCharacteristic(SSCS)
        .setProps({
          validValues: [SSCS.STAY_ARM, SSCS.AWAY_ARM, SSCS.DISARMED, SSCS.ALARM_TRIGGERED]
        })
        .setValue(AlarmStatus.toCurrentState(this.currentStatus))
        .on('change', (oldState, newState) => {
          this.currentStatus = AlarmStatus.fromCurrentState(newState)
        })

      this.platform.characteristics['security-system-target-state'] = service
        .getCharacteristic(SSTS)
        .setProps({
          validValues: [SSTS.STAY_ARM, SSTS.AWAY_ARM, SSTS.DISARM]
        })
        .setValue(AlarmStatus.toTargetState(this.currentStatus))
        .on('set', (newState, callback) => {
          // TODO: implement this request

          const newStatus = AlarmStatus.fromTargetState(newState)
          this.platform.log('Activation message:', this.createActivationMessage(newStatus))

          service.getCharacteristic(SSCS).setValue(AlarmStatus.toCurrentState(newStatus))
          callback()
        })

      return [service].concat(super.getServices())
    }

    createActivationMessage(newStatus) {
      const version = this.platform.config.smsV2Support ? 2 : 1
      const systemUserId = this.platform.config.systemUserId
      const pinCode = this.platform.config.pinCode

      const status = newStatus === AlarmStatus.ARMED_AWAY
        || newStatus === AlarmStatus.ARMED_HOME
        ? 1 : 0
      const group = newStatus === AlarmStatus.ARMED_HOME
        || (newStatus === AlarmStatus.DISARMED && this.currentStatus === AlarmStatus.ARMED_HOME)
        ? 1 : 0
      const now = new Date()

      let user = ''
      if (version >= 2) {
        if (systemUserId > 0) {
          user = ('00' + systemUserId.toString(16)).substr(-2)
        } else {
          user = 'FF'
        }
      }

      const data = [
        version,
        status,
        group,
        now.getFullYear().toString().substr(-2),
        now.getMonth().toString(16),
        ('00' + now.getDate()).substr(-2),
        ('00' + now.getHours()).substr(-2),
        ('00' + now.getMinutes()).substr(-2),
        user,
      ].join('').toUpperCase()

      const paddedData = (data + '0000000000000000').substring(0, 16)

      const key = Buffer.from('000000000000' + pinCode, 'utf8')
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
      cipher.setAutoPadding(false)

      const encrypted = Buffer.concat([
        cipher.update(paddedData, 'utf8'),
        cipher.final()
      ])

      return iv.toString('hex') + encrypted.toString('hex')
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
      this.lastSeenETag = null
      this.loadEventLogTimeout = null
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
      if (this.loadEventLogTimeout !== null) {
        clearTimeout(this.loadEventLogTimeout)
        this.loadEventLogTimeout = null
      }

      this.api.get('/log/recent', { count: 1000, since_id: this.lastSeenEventId })
        .set('If-None-Match', this.lastSeenETag)
        .then(res => {
          this.lastSeenETag = res.headers.etag || null
          this.updateCharacteristics(res.body.data)
        })
        .catch(err => {
          if (err && err.response) {
            if (err.status !== 304) {
              this.log('Failed to load the event log:', err.status, err.message)
            }
          } else {
            this.log('An error occurred when loading the event log:', err)
          }
        })
        .then(() => {
          if (this.loadEventLogTimeout !== null) {
            clearTimeout(this.loadEventLogTimeout)
            this.loadEventLogTimeout = null
          }

          this.loadEventLogTimeout = setTimeout(
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
          const activeGroupId = event.data.active_group_id

          let status = AlarmStatus.DISARMED
          if (activeGroupId === 0) {
            status = AlarmStatus.ARMED_AWAY
          } else if (activeGroupId > 0) {
            status = AlarmStatus.ARMED_HOME
          }

          setValue('security-system-target-state', AlarmStatus.toTargetState(status))

          if (event.data.activation_progress === 0) {
            setValue('security-system-current-state', AlarmStatus.toCurrentState(status))
          }
        } else if (event.log_type === 'temperature') {
          setValue('temperature-' + event.data.radio_code, event.data.degrees_celsius)
        }
      }
    }
  }

  homebridge.registerPlatform('homebridge-alert-alarm', 'AlertAlarm', AlertAlarmPlatform)
}
