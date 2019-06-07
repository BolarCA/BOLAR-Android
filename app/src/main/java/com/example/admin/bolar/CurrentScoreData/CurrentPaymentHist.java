package com.example.admin.bolar.CurrentScoreData;

public class CurrentPaymentHist {
    private String State;
    private int LatePayments;

    public CurrentPaymentHist() {}

    public CurrentPaymentHist(String State, int LatePayments){
        this.State = State;
        this.LatePayments = LatePayments;
    }

    public String getState(){
        return State;
    }

    public int getLatePayments(){
        return LatePayments;
    }
}
