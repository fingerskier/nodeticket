/**
 * Ygdrassil Vanilla JS State Machine
 *
 * A lightweight state machine implementation using only standard web APIs.
 * Manages states via URL hash changes and provides transition control.
 *
 * @example
 * const machine = new StateMachine({
 *   name: 'app',
 *   initial: 'home',
 *   states: {
 *     home: {
 *       onEnter: () => console.log('Entered home'),
 *       onExit: () => console.log('Exiting home'),
 *       transition: ['about', 'contact']
 *     },
 *     about: {
 *       onEnter: () => console.log('Entered about')
 *     }
 *   }
 * })
 */
export class StateMachine {
  /**
   * @param {Object} config - Configuration object
   * @param {string} [config.name='#'] - Machine name (appears in URL as yg-<name>)
   * @param {string} [config.initial] - Initial state to activate
   * @param {Object} [config.states={}] - State definitions
   * @param {Function} [config.onEnter] - Global callback fired when entering any state
   * @param {Function} [config.onExit] - Global callback fired when exiting any state
   * @param {Function} [config.onTransitionDenied] - Called with (from, to) when a transition is denied
   */
  constructor(config = {}) {
    this.name = config.name || '#'
    this.param = `yg-${this.name}`
    this.states = {}
    this.currentState = null
    this.globalOnEnter = config.onEnter
    this.globalOnExit = config.onExit
    this.onTransitionDenied = config.onTransitionDenied
    this._listeners = []
    this._initialStateEnterPending = false

    // Register states from config
    if (config.states) {
      Object.entries(config.states).forEach(([name, definition]) => {
        this.registerState(name, definition)
      })
    }

    // Bind methods to maintain 'this' context
    this._handleHashChange = this._handleHashChange.bind(this)

    // Initialize
    this._init(config.initial)
  }

  /**
   * Initialize the state machine
   * @private
   */
  _init(initial) {
    // Read current state from URL
    const urlState = this._readParam()
    const target = urlState || initial

    if (target) {
      this.currentState = target
      if (!urlState) this._writeParam(target)
      const def = this.states[target]
      if (def?.onEnter) {
        def.onEnter()
      } else {
        // Definition not registered yet (e.g. web-component discovery runs
        // after construction) — back-fill in registerState.
        this._initialStateEnterPending = true
      }
      if (this.globalOnEnter) this.globalOnEnter(target)
    }

    // Listen for hash changes
    window.addEventListener('hashchange', this._handleHashChange)
  }

  /**
   * Read the state parameter from URL hash
   * @private
   */
  _readParam() {
    const hash = window.location.hash
    const search = hash.startsWith('#?') ? hash.slice(2) : ''
    const params = new URLSearchParams(search)
    return params.get(this.param)
  }

  /**
   * Write the state parameter to URL hash
   * @private
   */
  _writeParam(state, data = null, replace = false) {
    const currentHash = window.location.hash.startsWith('#?')
      ? window.location.hash.slice(2)
      : ''
    const params = new URLSearchParams(currentHash)

    // Handle data with replace semantics
    if (data) {
      if (replace) {
        // Remove all non-yg- params first
        const keys = Array.from(params.keys())
        keys.forEach(key => {
          if (!key.startsWith('yg-')) {
            params.delete(key)
          }
        })
      }
      Object.entries(data).forEach(([k, v]) => {
        if (v == null) {
          params.delete(k)
        } else {
          params.set(k, String(v))
        }
      })
    }

    params.set(this.param, state)
    const newHash = `#?${params.toString()}`
    window.history.pushState(null, '', newHash)
  }

  /**
   * Rewrite this machine's param back to a state without adding a history
   * entry and without re-dispatching hashchange (avoids loops between machines).
   * @private
   */
  _repairParam(state) {
    const currentHash = window.location.hash.startsWith('#?')
      ? window.location.hash.slice(2)
      : ''
    const params = new URLSearchParams(currentHash)
    params.set(this.param, state)
    window.history.replaceState(null, '', `#?${params.toString()}`)
  }

  /**
   * Read all query parameters from URL hash
   */
  getQuery() {
    const hash = window.location.hash
    const search = hash.startsWith('#?') ? hash.slice(2) : ''
    const params = new URLSearchParams(search)
    const result = {}

    params.forEach((value, key) => {
      // Try to parse as number if it looks like one
      const num = Number(value)
      result[key] = !isNaN(num) && value !== '' ? num : value
    })

    return result
  }

  /**
   * Update query parameters in URL hash
   * @param {Object} obj - Object with key-value pairs to set
   * @param {boolean} [replace=false] - If true, replace all non-yg- params
   */
  setQuery(obj, replace = false) {
    const currentHash = window.location.hash.startsWith('#?')
      ? window.location.hash.slice(2)
      : ''
    const params = new URLSearchParams(currentHash)

    if (replace) {
      // Remove all non-yg- params first
      const keys = Array.from(params.keys())
      keys.forEach(key => {
        if (!key.startsWith('yg-')) {
          params.delete(key)
        }
      })
    }

    Object.entries(obj).forEach(([k, v]) => {
      if (v == null) {
        params.delete(k)
      } else {
        params.set(k, String(v))
      }
    })

    const newHash = `#?${params.toString()}`
    window.history.pushState(null, '', newHash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  /**
   * Handle hash change events
   * @private
   */
  _handleHashChange() {
    const nextState = this._readParam()

    if (!nextState) {
      // State parameter removed - deactivate current state
      if (this.currentState) {
        const current = this.states[this.currentState]
        if (current?.onExit) current.onExit()
        if (this.globalOnExit) this.globalOnExit(this.currentState)
        this.currentState = null
        this._notifyListeners()
      }
      return
    }

    if (nextState === this.currentState) {
      // State unchanged — but the query may have changed.
      this._notifyListeners()
      return
    }

    this._transitionToState(nextState)
  }

  /**
   * Internal state transition logic
   * @private
   */
  _transitionToState(nextState) {
    const prevState = this.currentState
    const prev = prevState ? this.states[prevState] : null
    const next = this.states[nextState]

    // Check if transition is allowed
    if (prev?.transition && !prev.transition.includes(nextState)) {
      console.warn(`Transition from "${prevState}" to "${nextState}" not allowed.`)
      if (this.onTransitionDenied) this.onTransitionDenied(prevState, nextState)
      // The URL already shows the forbidden state — repair it.
      if (prevState) this._repairParam(prevState)
      return false
    }

    // A committed transition supersedes any pending initial-enter back-fill.
    this._initialStateEnterPending = false

    // Execute state-level handlers
    if (prev?.onExit) prev.onExit()
    if (next?.onEnter) next.onEnter()

    // Execute global handlers
    if (prevState && this.globalOnExit) this.globalOnExit(prevState)
    if (this.globalOnEnter) this.globalOnEnter(nextState)

    this.currentState = nextState
    this._notifyListeners()
    return true
  }

  /**
   * Register a new state
   * @param {string} name - State name
   * @param {Object} definition - State definition
   * @param {Function} [definition.onEnter] - Called when entering this state
   * @param {Function} [definition.onExit] - Called when exiting this state
   * @param {string[]} [definition.transition] - Allowed transitions from this state
   */
  registerState(name, definition = {}) {
    this.states[name] = {
      onEnter: definition.onEnter,
      onExit: definition.onExit,
      transition: definition.transition
    }
    if (this._initialStateEnterPending && name === this.currentState) {
      this._initialStateEnterPending = false
      if (this.states[name].onEnter) this.states[name].onEnter()
    }
    this._notifyListeners()
  }

  /**
   * Unregister a state
   * @param {string} name - State name to remove
   */
  unregisterState(name) {
    delete this.states[name]
    this._notifyListeners()
  }

  /**
   * Navigate to a different state
   * @param {string} nextState - Target state name
   * @param {Object} [data] - Additional query parameters to set
   * @param {boolean} [replace=false] - If true, replace all non-yg- query params
   * @returns {boolean} False when the transition is denied
   */
  gotoState(nextState, data = null, replace = false) {
    if (this.currentState === nextState && !data) {
      return true // No-op if same state and no data changes
    }

    const current = this.states[this.currentState]
    if (current?.transition && !current.transition.includes(nextState)) {
      console.warn(`Transition from "${this.currentState}" to "${nextState}" not allowed.`)
      if (this.onTransitionDenied) this.onTransitionDenied(this.currentState, nextState)
      return false
    }

    this._writeParam(nextState, data, replace)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return true
  }

  /**
   * Close this state machine (removes state param from URL)
   */
  close() {
    const currentHash = window.location.hash.startsWith('#?')
      ? window.location.hash.slice(2)
      : ''
    const params = new URLSearchParams(currentHash)
    params.delete(this.param)

    const newHash = params.toString() ? `#?${params.toString()}` : ''
    window.history.pushState(null, '', newHash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  /**
   * Check if the current state matches a given name
   * @param {string} state - State name to check
   * @returns {boolean}
   */
  is(state) {
    return this.currentState === state
  }

  /**
   * Get available transitions from current state.
   * @returns {string[] | null} Allowed next states; null means unrestricted
   *   (any state), an empty array means terminal (no transitions allowed).
   */
  getAvailableTransitions() {
    if (!this.currentState) return null
    return this.states[this.currentState]?.transition ?? null
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function called when state changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.push(listener)
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener)
    }
  }

  /**
   * Notify all subscribers of state change
   * @private
   */
  _notifyListeners() {
    this._listeners.forEach(listener => {
      listener({
        currentState: this.currentState,
        states: this.states,
        query: this.getQuery()
      })
    })
  }

  /**
   * Clean up and remove event listeners
   */
  destroy() {
    window.removeEventListener('hashchange', this._handleHashChange)
    this._listeners = []
  }
}

/**
 * Helper function to create state navigation buttons
 * @param {StateMachine} machine - State machine instance
 * @param {string} targetState - State to navigate to
 * @param {Object} [options] - Options
 * @param {Object} [options.data] - Query parameters to pass
 * @param {boolean} [options.replace] - Replace query params
 * @param {string} [options.text] - Button text (defaults to targetState)
 * @param {string} [options.className] - Additional CSS classes
 * @returns {HTMLButtonElement}
 */
export function createStateButton(machine, targetState, options = {}) {
  const button = document.createElement('button')
  button.textContent = options.text || targetState

  const updateClass = () => {
    const classes = [options.className || '']
    if (machine.is(targetState)) {
      classes.push('active')
      button.setAttribute('aria-current', 'page')
    } else {
      button.removeAttribute('aria-current')
    }
    if (isUnavailable(machine, targetState)) {
      classes.push('unavailable')
      button.setAttribute('aria-disabled', 'true')
    } else {
      button.removeAttribute('aria-disabled')
    }
    button.className = classes.filter(Boolean).join(' ')
  }

  updateClass()
  machine.subscribe(updateClass)

  button.addEventListener('click', () => {
    machine.gotoState(targetState, options.data, options.replace)
  })

  return button
}

/**
 * Helper function to create state navigation links
 * @param {StateMachine} machine - State machine instance
 * @param {string} targetState - State to navigate to
 * @param {Object} [options] - Options
 * @param {Object} [options.data] - Query parameters to pass
 * @param {boolean} [options.replace] - Replace query params
 * @param {string} [options.text] - Link text (defaults to targetState)
 * @param {string} [options.className] - Additional CSS classes
 * @returns {HTMLAnchorElement}
 */
export function createStateLink(machine, targetState, options = {}) {
  const link = document.createElement('a')
  link.textContent = options.text || targetState

  const updateHrefAndClass = () => {
    const classes = [options.className || '']
    if (machine.is(targetState)) {
      classes.push('active')
      link.setAttribute('aria-current', 'page')
    } else {
      link.removeAttribute('aria-current')
    }
    if (isUnavailable(machine, targetState)) {
      classes.push('unavailable')
      link.setAttribute('aria-disabled', 'true')
    } else {
      link.removeAttribute('aria-disabled')
    }
    link.className = classes.filter(Boolean).join(' ')

    // Build href
    const query = machine.getQuery()
    const base = options.replace
      ? Object.fromEntries(
          Object.entries(query).filter(([k]) => k.startsWith('yg-'))
        )
      : { ...query }

    base[machine.param] = targetState

    if (options.data) {
      Object.entries(options.data).forEach(([k, v]) => {
        if (v == null) {
          delete base[k]
        } else {
          base[k] = v
        }
      })
    }

    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries(base).map(([k, v]) => [k, String(v)])
      )
    )
    link.href = `#?${params.toString()}`
  }

  updateHrefAndClass()
  machine.subscribe(updateHrefAndClass)

  return link
}

/**
 * Whether a target state is reachable from the machine's current state.
 * @private
 */
function isUnavailable(machine, targetState) {
  if (machine.is(targetState)) return false
  const allowed = machine.getAvailableTransitions()
  return allowed !== null && !allowed.includes(targetState)
}

export default StateMachine
