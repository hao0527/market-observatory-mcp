import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'每日资产观测站',description:'为每日盘前分析提供可溯源的全球市场数据'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
