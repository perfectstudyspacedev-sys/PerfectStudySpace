import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// A UPI pay link as a QR code (made in the browser; nothing is sent anywhere).
export default function UpiQr({ link }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(link)
    qr.make()
    return qr.createDataURL(5, 2)
  }, [link])
  return <img src={src} alt="UPI payment QR code" className="portal-qr" />
}
