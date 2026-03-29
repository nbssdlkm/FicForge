import { Tag } from '../shared/Tag';
import { Card } from '../shared/Card';

export const FactCard = ({ fact }: { fact: any }) => {
  return (
    <Card className={`hover:shadow-medium cursor-pointer transition-all border-l-4 ${fact.status === 'unresolved' ? 'border-l-accent' : fact.status === 'active' ? 'border-l-info' : 'border-l-transparent'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex gap-2 items-center">
          <Tag variant={fact.status}>{fact.status.toUpperCase()}</Tag>
          <span className="text-xs font-mono text-text/50">#{fact.chapter}</span>
        </div>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${fact.weight === 'high' ? 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30' : fact.weight === 'low' ? 'text-text/40' : 'text-text/60'}`} title="Narrative Weight">{fact.weight === 'high' ? '高' : fact.weight === 'low' ? '低' : '中'}</span>
      </div>
      <p className={`text-sm mt-1 mb-3 ${fact.status === 'deprecated' ? 'line-through opacity-50' : 'text-text/90'}`}>
        {fact.content_clean}
      </p>
      <div className="flex gap-2 flex-wrap">
        {fact.characters.map((c: string) => (
           <span key={c} className="text-xs text-accent/80 font-medium">@{c}</span>
        ))}
      </div>
    </Card>
  );
};
