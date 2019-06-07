package com.example.admin.bolar.CurrentScoreData;

public class CurrentAvgDuration {

    private String State;
    private int Months;
    private int Years;

    public CurrentAvgDuration() {}

    public CurrentAvgDuration(String State, int Months, int Years){
        this.State = State;
        this.Months = Months;
        this.Years = Years;
    }

    public String getState(){
        return State;
    }

    public int getMonths(){
        return Months;
    }

    public int getYears(){
        return Years;
    }
}
