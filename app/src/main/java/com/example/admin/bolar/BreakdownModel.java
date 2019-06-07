package com.example.admin.bolar;

public class BreakdownModel {

    private String address;
    private String data1;
    private String data2;

    public BreakdownModel(String address, String data1, String data2){
        this.address = address;
        this.data1 = data1;
        this.data2 = data2;
    }

    public String getAddress(){
        return address;
    }

    public String getData1(){
        return data1;
    }

    public String getData2(){
        return data2;
    }
}
