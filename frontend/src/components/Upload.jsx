import { useState } from 'react'
import axios from 'axios'

export default function Upload() {
  const [file, setFile] = useState(null)

  const send = async () => {
    const form = new FormData()
    form.append('image', file)

    const res = await axios.post('http://localhost:5000/api/upload', form)
    alert(res.data.step_file)
  }

  return (
    <div>
      <input type='file' onChange={e => setFile(e.target.files[0])} />
      <button onClick={send}>Generate STEP</button>
    </div>
  )
}
