import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './App.css' // <-- THIS IS THE MAGIC LINE

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)