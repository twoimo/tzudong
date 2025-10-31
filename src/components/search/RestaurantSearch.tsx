import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface RestaurantSearchProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  className?: string;
}

const RestaurantSearch = ({ onRestaurantSelect, className }: RestaurantSearchProps) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 맛집 검색 쿼리 (전체 맛집 대상)
  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ["restaurant-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];

      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .ilike("name", `%${searchQuery}%`)
        .limit(10);

      if (error) throw error;
      return data as Restaurant[];
    },
    enabled: searchQuery.length > 0,
  });

  const handleSelect = (restaurant: Restaurant) => {
    onRestaurantSelect(restaurant);
    setOpen(false);
    setSearchQuery("");
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[300px] justify-between"
          >
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <span className="truncate">
                {searchQuery || "맛집 검색..."}
              </span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput
              placeholder="맛집 이름을 입력하세요..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "검색 중..." : "검색 결과가 없습니다."}
              </CommandEmpty>
              <CommandGroup>
                {restaurants.map((restaurant) => (
                  <CommandItem
                    key={restaurant.id}
                    value={restaurant.name}
                    onSelect={() => handleSelect(restaurant)}
                    className="flex items-center gap-2 p-3"
                  >
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium">{restaurant.name}</span>
                      <span className="text-sm text-muted-foreground truncate">
                        {restaurant.address}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default RestaurantSearch;
