import { hash } from '@/lib/parse/html'
import { cn } from '@/lib/utils'

/** Round avatar for posts and headers: the book's cover crop, or its initial on a colour derived from the title. */
export function BookAvatar({
  title,
  avatar,
  className,
}: {
  title: string
  avatar: string | null
  className?: string
}) {
  const base = 'relative z-[1] grid size-10 shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white'
  if (avatar)
    return (
      <span className={cn(base, className)}>
        <img src={avatar} alt="" className="block size-full object-cover" />
      </span>
    )
  return (
    <span className={cn(base, 'text-lg', className)} style={{ background: `hsl(${hash(title) % 360} 42% 30%)` }}>
      {(title.trim()[0] || 'B').toUpperCase()}
    </span>
  )
}
